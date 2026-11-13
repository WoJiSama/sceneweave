import { zipSync } from 'fflate'
import { z } from 'zod'
import { captureJson, canonicalJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { captureBytes, sha256Bytes } from '../project/binary.js'
import { parseBoundedJson } from '../project/json.js'
import { inspectImageBytes } from '../project/image-bytes.js'
import { inspectBoundedZip } from '../project/zip.js'
import { checkCancelled, type CancellationSignal } from '../ports/resources.js'
import { assertImagePoint, imagePointSchema } from './calibration.js'
import { imageImportLayerSchema, imageImportRecipeSchema, parseImageImportRecipe } from './recipe.js'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'
import { GUIDED_SELECTION_LIMITS, guidedSelectionSchema } from './guided-selection.js'
import { imageSelectionOriginSchema, assertImageSelectionOrigin } from './selection-origin.js'
import { validateImageSubjectRefinement } from './subject-refinement.js'

export const IMAGE_WORK_LIMITS = Object.freeze({ stateBytes: 8 * 1024 * 1024, imageBytes: 20 * 1024 * 1024,
  packageBytes: 49 * 1024 * 1024, journal: 2048, reviews: 1024 })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(value => value !== '__proto__')
const points = z.array(imagePointSchema).max(512)
const guided = z.strictObject({ bounds: guidedSelectionSchema.shape.bounds,
  boundaryPx: guidedSelectionSchema.shape.boundaryPx,
  outlineRadiusPx: guidedSelectionSchema.shape.outlineRadiusPx,
  algorithmVersion: guidedSelectionSchema.shape.algorithmVersion,
  foreground: z.array(guidedSelectionSchema.shape.foreground.element).max(GUIDED_SELECTION_LIMITS.strokes),
  background: z.array(guidedSelectionSchema.shape.background.element).max(GUIDED_SELECTION_LIMITS.strokes),
  edgeRadiusPx: guidedSelectionSchema.shape.edgeRadiusPx,
  edgeCoverage: guidedSelectionSchema.shape.edgeCoverage })
const draftSchema = z.strictObject({ title: z.string().min(1).max(120),
  calibration: imageImportRecipeSchema.shape.calibration.nullable(), roomPointsPx: points.max(256),
  layers: z.array(imageImportLayerSchema).max(63), sourceBoundaryPx: points.max(256).optional(),
  floorVector: imageImportRecipeSchema.shape.floorVector,
  outputScale: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
  repairSurfaces: imageImportRecipeSchema.shape.repairSurfaces,
  rulerPointsPx: points.max(2).optional(), distanceInput: z.string().max(32).optional(), originPx: imagePointSchema.optional() })
const activeSchema = z.strictObject({ id: id.optional(), name: z.string().max(120), polygon: points, donor: points.max(2),
  fillPolygonPx: points.optional(), fillDonorPx: points.max(2).optional(),
  selectionMask: imageSelectionMaskSchema.optional(), selectionOrigin: imageSelectionOriginSchema.optional(), guided: guided.optional(),
  removalMask: imageImportLayerSchema.shape.removalMask, protectionMask: imageImportLayerSchema.shape.protectionMask,
  removalPointsPx: points.max(256).optional(), protectionPointsPx: points.max(256).optional(),
  emptySelectionBounds: guidedSelectionSchema.shape.bounds.optional(),
  fills: imageImportLayerSchema.shape.fills, repair: imageImportLayerSchema.shape.repair,
  appearanceSource: imageImportLayerSchema.shape.appearanceSource, repairSurfaceIds: imageImportLayerSchema.shape.repairSurfaceIds,
  subjectRefinement: imageImportLayerSchema.shape.subjectRefinement,
  cleanupPx: imageImportLayerSchema.shape.cleanupPx, renderLayer: z.enum(['ground', 'object']), blocksMovement: z.boolean(),
  footprintPx: imageImportLayerSchema.shape.footprintPx, editingLayerId: id.optional() })

/** Incomplete authoring state is distinct from a valid, adopted scene or a visual acceptance receipt. */
export const imageWorkStateSchema = z.strictObject({ format: z.literal('sceneweave-image-work'), version: z.literal(1),
  id, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), image: imageImportRecipeSchema.shape.image,
  original: z.strictObject({ sha256: hash, sizeBytes: z.number().int().positive().max(IMAGE_WORK_LIMITS.imageBytes),
    name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f/\\]+$/), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']) }),
  rights: z.strictObject({ licenseText: z.string().max(256 * 1024), attribution: z.string().max(4096), canEmbed: z.boolean() }),
  draft: draftSchema, active: activeSchema.optional(), notes: z.string().max(64 * 1024), nextAction: z.string().max(4096),
  scaleStatus: z.enum(['provisional', 'measured']),
  journal: z.array(z.strictObject({ action: z.string().min(1).max(120), note: z.string().max(4096), inputHash: hash,
    outputHash: hash, paramsJson: z.string().max(256 * 1024).optional() })).max(IMAGE_WORK_LIMITS.journal),
  reviews: z.array(z.strictObject({ target: z.string().min(1).max(80), inputHash: hash, itemSha256: hash,
    backgroundSha256: hash, verdict: z.enum(['needs-work', 'reviewed']), reviewer: z.enum(['assistant', 'human']),
    note: z.string().max(4096) })).max(IMAGE_WORK_LIMITS.reviews),
})
export type ImageWorkState = z.infer<typeof imageWorkStateSchema>
export interface ImageWorkPackage { state: ImageWorkState; original: Uint8Array; normalized: Uint8Array }

/** Capture and validate even incomplete work; a caller's supplied review never exempts candidate validation. */
export function parseImageWorkState(input: unknown): ImageWorkState {
  const state = imageWorkStateSchema.parse(captureJson(input)), { image, draft, active } = state
  const encoded = encodeUtf8(canonicalJson(state))
  if (encoded.length > IMAGE_WORK_LIMITS.stateBytes) throw new Error('图片工作记录超过8MiB。')
  const inImage = (values: readonly { x: number; y: number }[]) => values.forEach(point => assertImagePoint(image, point))
  inImage(draft.roomPointsPx); inImage(draft.sourceBoundaryPx ?? [])
  inImage(draft.rulerPointsPx ?? []); if (draft.originPx) inImage([draft.originPx])
  // Complete layers have the same domain validation as an adoptable recipe. Only unfinished room/ruler input is relaxed.
  parseImageImportRecipe({ format: 'sceneweave-image-import-recipe', version: 1, image, title: draft.title,
    calibration: draft.calibration ?? { first: { x: 0, y: 0 }, second: { x: image.pixelWidth, y: 0 }, distanceMm: image.pixelWidth },
    roomPointsPx: [{ x: 0, y: 0 }, { x: image.pixelWidth, y: 0 }, { x: image.pixelWidth, y: image.pixelHeight }], layers: draft.layers, ...(draft.repairSurfaces ? { repairSurfaces: draft.repairSurfaces } : {}) })
  if (active) {
    validateImageSubjectRefinement({ width: image.pixelWidth, height: image.pixelHeight }, active.subjectRefinement)
    if (active.repairSurfaceIds && (new Set(active.repairSurfaceIds).size !== active.repairSurfaceIds.length || active.repairSurfaceIds.some(id => !draft.repairSurfaces?.some(surface => surface.id === id)))) throw new Error('当前物件引用了不存在或重复的补底表面。')
    inImage(active.polygon); inImage(active.donor)
    inImage(active.fillPolygonPx ?? []); inImage(active.fillDonorPx ?? [])
    inImage(active.removalPointsPx ?? []); inImage(active.protectionPointsPx ?? [])
    for (const mask of [active.removalMask, active.protectionMask]) if (mask) decodeSelectionMask(mask, { width: image.pixelWidth, height: image.pixelHeight })
    if (active.editingLayerId && !draft.layers.some(layer => layer.id === active.editingLayerId)) throw new Error('当前精修物件不在工作记录中。')
    if (active.selectionMask) decodeSelectionMask(active.selectionMask, { width: image.pixelWidth, height: image.pixelHeight })
    if (active.selectionOrigin) {
      if (!active.selectionMask) throw new Error('本机候选来源必须伴随确切选区。')
      assertImageSelectionOrigin(active.selectionOrigin, image)
    }
    if (active.emptySelectionBounds) {
      if (active.selectionMask) throw new Error('当前选区不能同时为空和包含像素。')
      const bounds = active.emptySelectionBounds
      inImage([{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height }])
      if (bounds.width * bounds.height > 1_000_000) throw new Error('未完成选区超过100万像素。')
    }
    if (active.footprintPx) {
      const value = active.footprintPx
      inImage([{ x: value.x, y: value.y }, { x: value.x + value.width, y: value.y + value.height }])
    }
    for (const fill of active.fills ?? []) {
      inImage(fill.polygon)
      inImage([{ x: fill.donor.x, y: fill.donor.y }, { x: fill.donor.x + fill.donor.width, y: fill.donor.y + fill.donor.height }])
    }
    if (active.guided) {
      const value = active.guided, rectangle = value.bounds
      if (value.edgeCoverage && value.algorithmVersion !== 2) throw new Error('外缘透明过渡需要显式辅助算法2。')
      if (value.boundaryPx) {
        if (value.algorithmVersion !== 2) throw new Error('粗轮廓约束需要显式辅助算法2。')
        inImage(value.boundaryPx)
        if (value.boundaryPx.some(point => point.x < rectangle.x || point.y < rectangle.y || point.x > rectangle.x + rectangle.width || point.y > rectangle.y + rectangle.height)) throw new Error('辅助粗轮廓超出本物件范围。')
      }
      inImage([{ x: rectangle.x, y: rectangle.y }, { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height }])
      if (rectangle.width * rectangle.height > GUIDED_SELECTION_LIMITS.pixels) throw new Error('辅助选区超过25万像素。')
      for (const mark of [...value.foreground, ...value.background]) {
        inImage(mark.points)
        if (mark.points.some(point => point.x < rectangle.x || point.y < rectangle.y || point.x > rectangle.x + rectangle.width || point.y > rectangle.y + rectangle.height)) {
          throw new Error('辅助笔迹超出本物件的局部范围。')
        }
      }
    }
  }
  assertSelectionMaskBudget([...draft.layers.flatMap(layer => [layer.selectionMask, layer.removalMask, layer.protectionMask, layer.subjectRefinement?.foregroundProtectionMask, layer.subjectRefinement?.excludedEvidenceMask]), ...(draft.repairSurfaces ?? []).flatMap(surface => [surface.mask, surface.excludedEvidenceMask]), active?.selectionMask, active?.removalMask, active?.protectionMask, active?.subjectRefinement?.foregroundProtectionMask, active?.subjectRefinement?.excludedEvidenceMask])
  for (const event of state.journal) if (event.paramsJson !== undefined) {
    if (encodeUtf8(event.paramsJson).length > 256 * 1024) throw new Error('单次操作参数超过256KiB。')
    captureJson(parseBoundedJson(encodeUtf8(event.paramsJson)))
  }
  return freezeJson(state)
}

function validateImages(state: ImageWorkState, original: Uint8Array, normalized: Uint8Array): void {
  if (original.length !== state.original.sizeBytes || sha256Bytes(original) !== state.original.sha256) throw new Error('工作包原始图片长度或SHA-256不匹配。')
  const originalHeader = inspectImageBytes(original, false), header = inspectImageBytes(normalized)
  if (originalHeader.mimeType !== state.original.mimeType) throw new Error('工作包原始图片实际类型不匹配。')
  if (header.mimeType !== 'image/png' || header.width !== state.image.pixelWidth || header.height !== state.image.pixelHeight
    || sha256Bytes(normalized) !== state.image.sha256) throw new Error('工作包规范化PNG尺寸、类型或SHA-256不匹配。')
}

/** Byte/header integrity only. A platform adapter must additionally decode pixels before publishing/restoring work. */
export async function writeImageWorkPackage(input: unknown, rawOriginal: Uint8Array, rawNormalized: Uint8Array, signal?: CancellationSignal): Promise<Uint8Array> {
  checkCancelled(signal)
  const state = parseImageWorkState(input), original = captureBytes(rawOriginal, IMAGE_WORK_LIMITS.imageBytes), normalized = captureBytes(rawNormalized, IMAGE_WORK_LIMITS.imageBytes)
  validateImages(state, original, normalized)
  const bytes = zipSync({ 'state.json': encodeUtf8(canonicalJson(state)), 'original.bin': original, 'normalized.png': normalized },
    { level: 3, mtime: new Date(1980, 0, 1) })
  if (bytes.length > IMAGE_WORK_LIMITS.packageBytes) throw new Error('图片工作包超过49MiB。')
  checkCancelled(signal)
  return bytes
}

export async function readImageWorkPackage(input: Uint8Array, signal?: CancellationSignal): Promise<ImageWorkPackage> {
  checkCancelled(signal)
  const bytes = captureBytes(input, IMAGE_WORK_LIMITS.packageBytes)
  const paths = ['state.json', 'original.bin', 'normalized.png']
  const zip = inspectBoundedZip(bytes, { requiredPaths: paths, documentPath: name => name === 'state.json',
    pathBudget(name) {
      if (!paths.includes(name)) throw new Error('图片工作包包含未知或不安全路径。')
      return name === 'state.json' ? IMAGE_WORK_LIMITS.stateBytes : IMAGE_WORK_LIMITS.imageBytes
    } }, signal)
  const state = parseImageWorkState(parseBoundedJson(await zip.read('state.json')))
  const original = await zip.read('original.bin'), normalized = await zip.read('normalized.png')
  validateImages(state, original, normalized)
  checkCancelled(signal)
  return { state, original, normalized }
}
