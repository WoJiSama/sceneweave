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
    reference, axis: z.enum(['horizontal', 'vertical']), reason: z.string().trim().min(1).max(400) })).max(32),
})
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
      for (let y = bounds.y; y < bounds.y + bounds.height; y++) for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        if (!maskCoverage(mask, x, y) || maskCoverage(excluded, x, y)) throw new Error('结构参考整块须位于可信同材质范围，不能跨过取证排除区。')
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
        return repairGuidedImageSurface(image, part, surface.donor, { ...neighborhoodEvidence, pattern: surface.guided!.orientation === 'soft' ? 'soft' : 'planks', orientation: surface.guided!.orientation, guides: surface.guided!.guides })
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
