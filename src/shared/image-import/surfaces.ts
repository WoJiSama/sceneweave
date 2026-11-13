import { z } from 'zod'
import type { ImagePixelMask, ImagePixels } from './pixels.js'
import { decodeSelectionMask, assertSelectionMaskBudget, imageSelectionMaskSchema } from './selection-mask.js'
import { maskCoverage } from './repair-scope.js'
import { repairMaterialSurface } from './material-repair.js'
import { repairExemplarSurface } from './exemplar-repair.js'
import { repairImageNeighborhood } from './neighborhood-repair.js'
import { imageNeighborhoodExcludedEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { repairGuidedImageSurface } from './guided-surface-repair.js'

const binary = imageSelectionMaskSchema.refine(mask => mask.runs.every((v, i) => i % 2 === 0 || v === 0 || v === 255), '表面与取证排除范围须为二值蒙版。')
const reference = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() })
export const imageSurfaceGuidanceSchema = z.strictObject({
  orientation: z.enum(['horizontal', 'vertical', 'soft']),
  guides: z.array(z.strictObject({ points: z.array(z.strictObject({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative() })).min(2).max(16),
    reference, axis: z.enum(['horizontal', 'vertical']), stroke: z.literal('original-segment').optional(), paper: z.literal('two-sided').optional(), reason: z.string().trim().min(1).max(400) })
    .refine(value => value.paper === undefined || value.stroke === 'original-segment' && (value.axis === 'horizontal' ? value.reference.height : value.reference.width) >= 9,
      '两侧底色须显式用于原尺寸接缝，参考横跨至少9px。')).max(32),
  detailPatches: z.array(z.strictObject({ role: z.enum(['board-end', 'nails', 'gap']), mode: z.literal('replace-ink').optional(), blendPx: z.number().int().min(1).max(4).optional(), reference: reference.extend({ width: z.number().int().min(5).max(64), height: z.number().int().min(5).max(64) }),
    target: z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }), reason: z.string().trim().min(1).max(400) })
    .refine(value => value.role !== 'gap' || value.mode === 'replace-ink', '断口必须显式替换生成笔迹，不能仅加深。')
    .refine(value => value.blendPx === undefined || value.mode === 'replace-ink' && Math.min(value.reference.width, value.reference.height) >= value.blendPx * 2 + 3,
      '笔迹过渡须显式用于替换模式，且宽高各保留至少3像素不混合核心。')).max(16).optional(),
}).refine(value => value.guides.length + (value.detailPatches?.length ?? 0) <= 32, '路径与二维笔迹合计最多32项。')
export const imageRepairSurfaceSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().min(1).max(120),
  kind: z.enum(['soft', 'planks', 'patches', 'neighbors-soft', 'neighbors-planks', 'guided']), mask: binary,
  donor: reference,
  excludedEvidenceMask: binary.optional(),
  guided: imageSurfaceGuidanceSchema.optional(),
}).superRefine((surface, context) => {
  if ((surface.kind === 'guided') !== !!surface.guided) context.addIssue({ code: 'custom', path: ['guided'], message: '结构辅助表面必须显式提供guided；其他底材类型不能携带guided。' })
})
export type ImageRepairSurface = z.infer<typeof imageRepairSurfaceSchema>

export function validateImageRepairSurfaces(image: { width: number; height: number }, surfaces: readonly ImageRepairSurface[]): void {
  if (surfaces.length > 16 || new Set(surfaces.map(s => s.id)).size !== surfaces.length) throw new Error('补底表面最多16项且身份不能重复。')
  assertSelectionMaskBudget(surfaces.flatMap(s => [s.mask, s.excludedEvidenceMask]))
  for (const raw of surfaces) {
    const surface = imageRepairSurfaceSchema.parse(raw)
    const mask = decodeSelectionMask(surface.mask, image), excluded = surface.excludedEvidenceMask && decodeSelectionMask(surface.excludedEvidenceMask, image)
    const d = surface.donor
    if (d.x + d.width > image.width || d.y + d.height > image.height) throw new Error('表面取样超出原图。')
    if (d.width * d.height > 1_000_000) throw new Error('表面取样最多100万像素。')
    for (let y = d.y; y < d.y + d.height; y++) for (let x = d.x; x < d.x + d.width; x++) {
      if (!maskCoverage(mask, x, y) || maskCoverage(excluded, x, y)) throw new Error(`表面“${surface.name}”取样必须位于可信同材质范围。`)
    }
    for (const guide of surface.guided?.guides ?? []) {
      for (const point of guide.points) if (point.x >= image.width || point.y >= image.height || !maskCoverage(mask, Math.floor(point.x), Math.floor(point.y))) throw new Error('结构辅助坐标须位于原图内且属于当前底材范围。')
      const bounds = guide.reference, along = guide.axis === 'horizontal' ? bounds.width : bounds.height, cross = guide.axis === 'horizontal' ? bounds.height : bounds.width
      if (along < 3 || cross < 5 || bounds.width * bounds.height > 4096 || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height) throw new Error('结构参考须位于原图内，沿线至少3像素、横跨至少5像素且最多4096像素。')
      if (guide.stroke === 'original-segment') {
        if (along < 5 || cross > 31) throw new Error('原尺寸接缝参考沿线至少5px、横跨5至31px。')
        const positions = guide.points.map(p => guide.axis === 'horizontal' ? p.x : p.y), direction = Math.sign(positions.at(-1)! - positions[0])
        if (!direction || positions.some((value, i) => i > 0 && Math.sign(value - positions[i - 1]) !== direction)) throw new Error('原尺寸接缝路径须沿参考方向单调，不能折返或有同轴重合段。')
      }
      for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        if (!maskCoverage(mask, x, y) || maskCoverage(excluded, x, y)) throw new Error('结构参考整块须位于可信同材质范围，不能跨过取证排除区。')
      }
    }
    const targets: Array<{ x: number; y: number; width: number; height: number }> = []
    for (const patch of surface.guided?.detailPatches ?? []) {
      const b = patch.reference, t = { ...patch.target, width: b.width, height: b.height }
      if (b.x + b.width > image.width || b.y + b.height > image.height || t.x + t.width > image.width || t.y + t.height > image.height) throw new Error('二维笔迹参考和目标须在原图内。')
      if (targets.some(other => t.x < other.x + other.width && t.x + t.width > other.x && t.y < other.y + other.height && t.y + t.height > other.y)) throw new Error('二维笔迹目标不能重叠。')
      targets.push(t)
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
        if (!maskCoverage(mask, b.x + x, b.y + y) || maskCoverage(excluded, b.x + x, b.y + y)) throw new Error('二维笔迹参考整块须位于可信同材质范围。')
        if (!maskCoverage(mask, t.x + x, t.y + y)) throw new Error('二维笔迹目标整块须在当前底材范围内。')
      }
    }
  }
}

/** First surface wins; every repair pixel must be covered. All surfaces read the same input. */
export function repairImageSurfaces(image: ImagePixels, repair: ImagePixelMask, surfaces: readonly ImageRepairSurface[], protection?: ImagePixelMask,
  neighborhood: { priorInference?: Uint8Array; objectEvidence?: readonly ImagePixelMask[]; signal?: ImageNeighborhoodSignal } = {}): ImagePixels {
  if (!surfaces.length) throw new Error('请先定义补底表面。')
  const data = image.data.slice(), covered = new Uint8Array(repair.data.length)
  for (const surface of surfaces) {
    const mask = decodeSelectionMask(surface.mask, image), excluded = surface.excludedEvidenceMask && decodeSelectionMask(surface.excludedEvidenceMask, image)
    const selected = new Uint8Array(repair.data.length); let count = 0
    for (let y = 0; y < repair.height; y++) for (let x = 0; x < repair.width; x++) {
      const i = y * repair.width + x
      if (repair.data[i] && !covered[i] && maskCoverage(mask, x + repair.boundsPx.x, y + repair.boundsPx.y)) { selected[i] = 255; covered[i] = 1; count++ }
    }
    if (!count) continue
    const part = { ...repair, data: selected }
    const evidence = { surfaceMask: mask, protectionMask: protection, excludedEvidenceMask: excluded }
    const needsNeighborhood = surface.kind === 'guided' || surface.kind === 'neighbors-soft' || surface.kind === 'neighbors-planks'
    const neighborhoodEvidence = { ...evidence, excludedEvidenceMask: needsNeighborhood ? imageNeighborhoodExcludedEvidence(mask.boundsPx, [repair, excluded, ...(neighborhood.objectEvidence ?? [])]) : excluded, priorInference: neighborhood.priorInference, signal: neighborhood.signal }
    const guidedOutput = () => {
      try {
        for (const [index, guide] of surface.guided!.guides.entries()) {
          const bounds = guide.reference
          for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
            if (maskCoverage(repair, x, y) || maskCoverage(protection, x, y) || maskCoverage(neighborhoodEvidence.excludedEvidenceMask, x, y)
              || neighborhood.priorInference?.[y * image.width + x] || image.data[(y * image.width + x) * 4 + 3] !== 255) throw new Error(`结构参考${index + 1}整块须为可见可信原像素，不能取自移除、保护、排除、前序推断或未移走的物件；不可信像素(${x}, ${y})。`)
          }
        }
        return repairGuidedImageSurface(image, part, surface.donor, { ...neighborhoodEvidence, pattern: surface.guided!.orientation === 'soft' ? 'soft' : 'planks', orientation: surface.guided!.orientation, guides: surface.guided!.guides, detailPatches: surface.guided!.detailPatches })
      } catch (error) {
        if (neighborhood.signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error
        const references = surface.guided!.guides.map((guide, index) => `${index + 1}:(${guide.reference.x}, ${guide.reference.y}) ${guide.reference.width}×${guide.reference.height}px ${guide.axis}`).join('；')
        throw new Error(`表面“${surface.name}”（${surface.id}）结构辅助失败。参考[${references || '无显式参考'}]。${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    }
    const output = surface.kind === 'guided'
      ? guidedOutput()
      : surface.kind === 'neighbors-soft' || surface.kind === 'neighbors-planks'
      ? repairImageNeighborhood(image, part, surface.donor, { ...neighborhoodEvidence, pattern: surface.kind === 'neighbors-planks' ? 'planks' : 'soft' }).pixels
      : surface.kind === 'patches' ? repairExemplarSurface(image, part, surface.donor, evidence)
      : repairMaterialSurface(image, part, surface.donor, { kind: surface.kind, ...evidence })
    for (let y = 0; y < part.height; y++) for (let x = 0; x < part.width; x++) if (selected[y * part.width + x]) {
      const at = ((y + part.boundsPx.y) * image.width + x + part.boundsPx.x) * 4
      data.set(output.data.subarray(at, at + 4), at)
    }
  }
  if (repair.data.some((v, i) => v && !covered[i])) throw new Error('补底表面没有覆盖全部实际移除像素，请补齐材质范围。')
  return { width: image.width, height: image.height, data }
}
