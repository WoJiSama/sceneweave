import { z } from 'zod'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'
import { replayImageLayers, type ImageReplayLayer } from './layer-replay.js'
import { imageNeighborhoodObjectEvidence, imageNeighborhoodExcludedEvidence, type ImageNeighborhoodSignal } from './neighborhood-evidence.js'
import { refineImageSubject } from '../image-enhancement/subject-matting.js'
import { refineImageContour } from '../image-enhancement/contour-coverage.js'
import type { ImagePixelMask, ImagePixels, PixelBounds } from './pixels.js'
import type { ImageRepairSurface } from './surfaces.js'

const binary = imageSelectionMaskSchema.refine(mask => mask.runs.every((v, i) => i % 2 === 0 || v === 0 || v === 255), '主体取证排除和前景保护须为二值蒙版。')
export const imageSubjectRefinementSchema = z.strictObject({
  method: z.enum(['subject-matte-v1', 'subject-contour-v1']),
  bandPx: z.union([z.literal(1), z.literal(2)]),
  strength: z.enum(['gentle', 'balanced', 'strong']),
  foregroundProtectionMask: binary.optional(),
  excludedEvidenceMask: binary.optional(),
}).refine(options => options.method !== 'subject-contour-v1' || options.bandPx === 1, '轮廓抗锯齿只允许内外各1原像素。')
export type ImageSubjectRefinement = z.infer<typeof imageSubjectRefinementSchema>
export type ImageSubjectLayer = ImageReplayLayer & { subjectRefinement?: ImageSubjectRefinement }

export function validateImageSubjectRefinement(image: { width: number; height: number }, options?: ImageSubjectRefinement): void {
  if (!options) return
  const parsed = imageSubjectRefinementSchema.parse(options)
  for (const mask of [parsed.foregroundProtectionMask, parsed.excludedEvidenceMask]) if (mask) decodeSelectionMask(mask, image)
  assertSelectionMaskBudget([parsed.foregroundProtectionMask, parsed.excludedEvidenceMask])
}

function subjectEvidence(source: ImagePixels, layers: readonly ImageSubjectLayer[], index: number, selection: ImagePixelMask,
  options: ImageSubjectRefinement, priorInference?: Uint8Array): ImagePixelMask | undefined {
  // Clip the temporary evidence union to the only region this local algorithm can read.
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
  const result = options.method === 'subject-contour-v1' ? refineImageContour(appearance, selection, constraints, signal)
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
    return { ...row, sourceExtracted: row.extracted, ...(result ? { subjectResult: result } : {}), extracted: result ? { ...row.extracted, layer: result.pixels } : row.extracted }
  }) }
}
