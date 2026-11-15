import { z } from 'zod'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { imageNeighborhoodObjectEvidence, imageNeighborhoodExcludedEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { refineImageSubject } from '../image-enhancement/subject-matting.js'
import { refineImageContour } from '../image-enhancement/contour-coverage.js'
import { refineImageSubjectReferences } from '../image-enhancement/subject-reference.js'
import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import type { ImageRepairSurface } from './surfaces.js'
import { maskCoverage } from './repair-scope.js'
import { previewImageImportSurface, type ImageSurfaceRefinement } from './surface-refinement.js'

const binary = imageSelectionMaskSchema.refine(mask => mask.runs.every((v, i) => i % 2 === 0 || v === 0 || v === 255), '主体取证排除和前景保护须为二值蒙版。')
const colorReference = binary.refine(mask => mask.width * mask.height <= 4096, '颜色参考图框最多4096个原图像素，请画短笔迹。')
export const imageSubjectRefinementSchema = z.strictObject({
  method: z.enum(['subject-matte-v1', 'subject-contour-v1', 'subject-reference-v1']),
  bandPx: z.union([z.literal(1), z.literal(2)]),
  strength: z.enum(['gentle', 'balanced', 'strong']),
  foregroundProtectionMask: binary.optional(),
  excludedEvidenceMask: binary.optional(),
  referenceGuidance: z.strictObject({ base: z.enum(['original', 'contour']), foreground: colorReference, background: colorReference, mixed: binary }).optional(),
}).refine(options => options.method !== 'subject-contour-v1' || options.bandPx === 1, '轮廓抗锯齿只允许内外各1原像素。')
  .refine(options => (options.method === 'subject-reference-v1') === !!options.referenceGuidance, '局部参考方式须有主体色、背景色、已确认混色边及明确基线；其他方式不携带该辅助。')
export type ImageSubjectRefinement = z.infer<typeof imageSubjectRefinementSchema>
export type ImageSubjectLayer = ImageReplayLayer & { subjectRefinement?: ImageSubjectRefinement; surfaceRefinement?: ImageSurfaceRefinement }

export function imageSubjectRefinementMasks(options?: ImageSubjectRefinement) {
  return [options?.foregroundProtectionMask, options?.excludedEvidenceMask,
    options?.referenceGuidance?.foreground, options?.referenceGuidance?.background, options?.referenceGuidance?.mixed]
}

export function validateImageSubjectRefinement(image: { width: number; height: number }, options?: ImageSubjectRefinement): void {
  if (!options) return
  const parsed = imageSubjectRefinementSchema.parse(options)
  for (const mask of imageSubjectRefinementMasks(parsed)) if (mask) decodeSelectionMask(mask, image)
  assertSelectionMaskBudget(imageSubjectRefinementMasks(parsed))
}

function subjectEvidence(source: ImagePixels, layers: readonly ImageSubjectLayer[], index: number, selection: ImagePixelMask,
  options: ImageSubjectRefinement, priorInference?: Uint8Array): ImagePixelMask | undefined {
  // Automatic local evidence stays bounded. Explicit colour references may lie
  // beyond this band and are checked at their actual coordinates below.
  const radius = 12, x = Math.max(0, selection.boundsPx.x - radius), y = Math.max(0, selection.boundsPx.y - radius)
  const right = Math.min(source.width, selection.boundsPx.x + selection.width + radius), bottom = Math.min(source.height, selection.boundsPx.y + selection.height + radius)
  const bounds: PixelBounds = { x, y, width: right - x, height: bottom - y }
  // Colour inference excludes neighbours' full removal/evidence scope. Geometric
  // coverage has no background colour evidence: only their actual silhouettes
  // block contour placement, while an unconfirmed neighbour keeps its rough box.
  const others = layers.filter((_, position) => position !== index)
  const layer = layers[index], masks = imageNeighborhoodObjectEvidence(source, options.method === 'subject-contour-v1'
    ? others.map(other => { const { removalMask: ignored, ...silhouette } = other; return silhouette }) : others)
  for (const encoded of [layer.protectionMask, options.excludedEvidenceMask]) if (encoded) masks.push(decodeSelectionMask(encoded, source))
  if (options.method === 'subject-reference-v1') {
    for (const encoded of [options.referenceGuidance!.foreground, options.referenceGuidance!.background]) {
      const reference = decodeSelectionMask(encoded, source)
      for (let yy = 0; yy < reference.height; yy++) for (let xx = 0; xx < reference.width; xx++) if (reference.data[yy * reference.width + xx]) {
        const sx = reference.boundsPx.x + xx, sy = reference.boundsPx.y + yy
        if (priorInference?.[sy * source.width + sx] || masks.some(mask => maskCoverage(mask, sx, sy))) {
          throw new Error(`原图参考(${sx},${sy})位于邻物、保护、取证排除或前序推断，不能作为颜色依据。`)
        }
      }
    }
  }
  if (priorInference) {
    const data = new Uint8Array(bounds.width * bounds.height)
    for (let yy = 0; yy < bounds.height; yy++) for (let xx = 0; xx < bounds.width; xx++) if (priorInference[(y + yy) * source.width + x + xx]) data[yy * bounds.width + xx] = 255
    masks.push({ width: bounds.width, height: bounds.height, boundsPx: bounds, data })
  }
  return imageNeighborhoodExcludedEvidence(bounds, masks)
}

/** Read-only staged candidate. Source reconstruction and repair permissions do not change. */
export function previewImageImportSubject<T extends ImageSubjectLayer>(source: ImagePixels, layers: readonly T[], surfaces: readonly ImageRepairSurface[] = [],
  target: string, input: ImageSubjectRefinement, signal?: ImageNeighborhoodSignal) {
  signal?.throwIfAborted()
  const options = imageSubjectRefinementSchema.parse(input), index = layers.findIndex(layer => layer.id === target)
  if (index < 0) throw new Error('主体目标不存在，请先确认完整物件选区。')
  validateImageSubjectRefinement(source, options)
  const replay = replayImageLayers(source, layers.slice(0, index + 1), surfaces, { evidenceLayers: layers, signal }), original = replay.layers[index].extracted.layer
  const selection = replay.layers[index].extracted.mask, layer = layers[index]
  const prior = layer.appearanceSource === 'original' ? undefined : replayImageLayers(source, layers.slice(0, index), surfaces, { evidenceLayers: layers, signal })
  const appearance = prior?.remaining ?? source
  const constraints = { strength: options.strength,
    excludedEvidenceMask: subjectEvidence(source, layers, index, selection, options, prior?.provenance),
    foregroundProtectionMask: options.foregroundProtectionMask ? decodeSelectionMask(options.foregroundProtectionMask, source) : undefined }
  const result = options.method === 'subject-reference-v1' ? (() => {
    const guidance = options.referenceGuidance!
    const geometry = guidance.base === 'contour' ? refineImageContour(appearance, selection, { ...constraints,
      excludedEvidenceMask: subjectEvidence(source, layers, index, selection, { ...options, method: 'subject-contour-v1' }, prior?.provenance) }, signal) : undefined
    const refined = refineImageSubjectReferences(appearance, selection, geometry?.pixels ?? original, { ...constraints, bandPx: options.bandPx,
      foreground: decodeSelectionMask(guidance.foreground, source), background: decodeSelectionMask(guidance.background, source),
      mixed: decodeSelectionMask(guidance.mixed, source), removalMask: replay.layers[index].extracted.repairMask }, signal)
    // Final metrics compare to the original grid, including optional geometric
    // coverage. Stage metrics remain separate for reviewing the colour step.
    const metrics = { ...refined.metrics, alphaChangedPixels: 0, rgbChangedPixels: 0 }
    for (let y = 0; y < refined.pixels.height; y++) for (let x = 0; x < refined.pixels.width; x++) {
      const sx = refined.pixels.boundsPx.x + x - original.boundsPx.x, sy = refined.pixels.boundsPx.y + y - original.boundsPx.y, to = (y * refined.pixels.width + x) * 4
      const inside = sx >= 0 && sy >= 0 && sx < original.width && sy < original.height, from = (sy * original.width + sx) * 4
      if (refined.pixels.data[to + 3] !== (inside ? original.data[from + 3] : 0)) metrics.alphaChangedPixels++
      if (refined.pixels.data[to + 3] && (!inside || [0, 1, 2].some(c => refined.pixels.data[to + c] !== original.data[from + c]))) metrics.rgbChangedPixels++
    }
    return { ...refined, metrics, referenceStageMetrics: refined.metrics,
      baseMethod: guidance.base, ...(geometry ? { baseMetrics: geometry.metrics } : {}) }
  })() : options.method === 'subject-contour-v1' ? refineImageContour(appearance, selection, constraints, signal)
    : refineImageSubject(appearance, selection, { ...constraints, bandPx: options.bandPx }, signal)
  signal?.throwIfAborted()
  return { ...result, original, recipe: options, derived: true as const, originalSourcePreserved: true as const, visualQualityPassed: false as const }
}

/** The opt-in display/output view. The baseline replay remains the source-fidelity witness. */
export function replayImageSubjectLayers<T extends ImageSubjectLayer>(source: ImagePixels, layers: readonly T[], surfaces: readonly ImageRepairSurface[] = [],
  context: { evidenceLayers?: readonly T[]; signal?: ImageNeighborhoodSignal } = {}) {
  const replay = replayImageLayers(source, layers, surfaces, context)
  const evidenceLayers = context.evidenceLayers ?? layers
  return { ...replay, layers: replay.layers.map(row => {
    const result = row.layer.subjectRefinement ? previewImageImportSubject(source, evidenceLayers, surfaces, row.layer.id, row.layer.subjectRefinement, context.signal) : undefined
    const surfaceResult = row.layer.surfaceRefinement ? previewImageImportSurface(source, evidenceLayers, surfaces, row.layer.id, row.layer.surfaceRefinement, context.signal) : undefined
    return { ...row, sourceExtracted: row.extracted, ...(result ? { subjectResult: result } : {}), ...(surfaceResult ? { surfaceResult } : {}), extracted: result || surfaceResult ? { ...row.extracted, layer: (result ?? surfaceResult)!.pixels } : row.extracted }
  }) }
}
