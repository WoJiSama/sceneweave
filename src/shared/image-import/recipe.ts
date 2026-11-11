import { z } from 'zod'
import { captureJson, freezeJson } from '../validation/json.js'
import { createImageCalibration, assertImagePoint, imagePointSchema } from './calibration.js'
import { imageVectorOptionsSchema } from './vector.js'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'

const points = z.array(imagePointSchema).min(3).max(256)
const donor = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive() })
export const imageImportLayerSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(value => value !== '__proto__'),
  name: z.string().trim().min(1).max(120), polygon: points, donor,
  renderLayer: z.enum(['ground', 'object']), blocksMovement: z.boolean(),
  repair: z.enum(['tile', 'seamless']).optional(),
  fills: z.array(z.strictObject({ polygon: points, donor })).max(8).optional(),
  cleanupPx: z.number().int().min(0).max(8).optional(),
  selectionMask: imageSelectionMaskSchema.optional(),
  vector: imageVectorOptionsSchema.optional(),
  footprintPx: z.strictObject({ x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(), height: z.number().finite().positive() }).optional(),
})
const calibrationSchema = z.strictObject({ first: imagePointSchema, second: imagePointSchema,
  distanceMm: z.number().int().positive(), originPx: imagePointSchema.optional() })
export const imageImportRecipeSchema = z.strictObject({
  format: z.literal('sceneweave-image-import-recipe'), version: z.literal(1),
  image: z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), pixelWidth: z.number().int().positive().max(8192), pixelHeight: z.number().int().positive().max(8192) }),
  title: z.string().trim().min(1).max(120), calibration: calibrationSchema,
  roomPointsPx: points, layers: z.array(imageImportLayerSchema).max(64),
  floorVector: imageVectorOptionsSchema.optional(),
  sourceBoundaryPx: points.optional(),
  outputScale: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
})
export type ImageImportRecipe = z.infer<typeof imageImportRecipeSchema>
export type ImageImportLayer = ImageImportRecipe['layers'][number]

/** A recipe identifies the exact normalized source. Pixels and permissions stay with the host. */
export function parseImageImportRecipe(input: unknown): ImageImportRecipe {
  const recipe = imageImportRecipeSchema.parse(captureJson(input))
  if (recipe.image.pixelWidth * recipe.image.pixelHeight > 32_000_000) throw new Error('原图超过3200万像素。')
  if (recipe.layers.length + 1 > 64) throw new Error('地板材质与拆出物件合计最多64项，请收窄采用范围。')
  createImageCalibration({ ...recipe.calibration, pixelWidth: recipe.image.pixelWidth, pixelHeight: recipe.image.pixelHeight })
  const ids = new Set<string>()
  assertSelectionMaskBudget(recipe.layers.map(layer => layer.selectionMask))
  for (const point of recipe.roomPointsPx) assertImagePoint(recipe.image, point)
  for (const point of recipe.sourceBoundaryPx ?? []) assertImagePoint(recipe.image, point)
  for (const layer of recipe.layers) {
    if (ids.has(layer.id)) throw new Error('拆解物件身份重复。')
    ids.add(layer.id)
    layer.polygon.forEach(point => assertImagePoint(recipe.image, point))
    if (layer.selectionMask) {
      decodeSelectionMask(layer.selectionMask, { width: recipe.image.pixelWidth, height: recipe.image.pixelHeight })
    }
    if (layer.footprintPx) {
      assertImagePoint(recipe.image, { x: layer.footprintPx.x, y: layer.footprintPx.y })
      assertImagePoint(recipe.image, { x: layer.footprintPx.x + layer.footprintPx.width, y: layer.footprintPx.y + layer.footprintPx.height })
    }
    if (layer.donor.x + layer.donor.width > recipe.image.pixelWidth || layer.donor.y + layer.donor.height > recipe.image.pixelHeight) throw new Error('补底取样超出原图。')
    for (const fill of layer.fills ?? []) {
      fill.polygon.forEach(point => assertImagePoint(recipe.image, point))
      if (fill.donor.x + fill.donor.width > recipe.image.pixelWidth || fill.donor.y + fill.donor.height > recipe.image.pixelHeight) throw new Error('分区补底取样超出原图。')
    }
  }
  return freezeJson(recipe)
}

const generation = { generation: z.number().int().nonnegative() }
export const imageImportToolArguments = {
  image_import_inspect: z.strictObject({}),
  image_import_set_scale: calibrationSchema.extend(generation),
  image_import_set_room: z.strictObject({ ...generation, points }),
  image_import_set_source_boundary: z.strictObject({ ...generation, points }),
  image_import_set_output_scale: z.strictObject({ ...generation, scale: z.union([z.literal(1), z.literal(2), z.literal(4)]) }),
  image_import_extract_item: imageImportLayerSchema.extend(generation),
  image_import_refine_selection: z.strictObject({ ...generation, target: z.string().min(1).max(80),
    strokes: z.array(z.strictObject({ mode: z.enum(['keep', 'remove']), points: z.array(imagePointSchema).min(1).max(512), radiusPx: z.number().finite().min(.5).max(64) })).max(64),
    contour: z.strictObject({ points: z.array(imagePointSchema).min(3).max(512), radiusPx: z.number().finite().min(1).max(32).optional() }).optional(),
  }),
  image_import_set_vector: z.strictObject({ ...generation, target: z.string().min(1).max(80), options: imageVectorOptionsSchema.nullable() }),
  image_import_vector_source: z.strictObject({ target: z.string().min(1).max(80) }),
  image_import_assess_fidelity: z.strictObject({}),
  image_import_undo: z.strictObject(generation),
  image_import_apply_recipe: z.strictObject({ ...generation, recipe: imageImportRecipeSchema }),
  image_import_suggest_region: z.strictObject({ seed: imagePointSchema, tolerance: z.number().min(0).max(255), maxPixels: z.number().int().positive().max(1000000).optional() }),
  image_import_preview: z.strictObject({ view: z.enum(['original', 'remaining', 'reconstructed', 'difference', 'inference']).default('remaining') }),
  image_import_build_project: z.strictObject({ ...generation, title: z.string().trim().min(1).max(120).optional() }),
}
export type ImageImportToolName = keyof typeof imageImportToolArguments
export const IMAGE_IMPORT_TOOLS = Object.entries(imageImportToolArguments).map(([name, schema]) => ({
  name, description: ({
    image_import_inspect: '读取已授权原图身份、当前拆解草稿和代次。',
    image_import_set_scale: '用原图两点和实际毫米距离设置比例。',
    image_import_set_room: '设置原图中的房间闭合轮廓。',
    image_import_set_source_boundary: '标注需要原样保留的原画外轮廓，包括黑墙，排除图外棋盘格。',
    image_import_set_output_scale: '设置1/2/4倍原色像素输出，不调色、不重画、不声称恢复原图缺失的细节。',
    image_import_extract_item: '按多边形提取原像素物件，并用指定露出纹理补底。上层先拆。',
    image_import_refine_selection: '在当前物件上磁性贴边或用保留/排除笔迹修正精细像素蒙版；保留原色与独立物理占地，成功重放才替换草稿。',
    image_import_set_vector: '清除旧描摹/模板设置（options:null）。当前trace/wood/rug会改变原图颜色与笔触，保真导入拒绝启用。',
    image_import_vector_source: '读取既有矢量提案的源；当前改变画风的矢量重建不能作为原图保真结果采用。',
    image_import_assess_fidelity: '将当前拆解合成与原图在同坐标对照，返回保真规则、像素差异和单独的遮挡推断范围；不是存取自我比较。',
    image_import_undo: '撤销上一步拆解，推进代次。',
    image_import_apply_recipe: '在确切原图上重放完整提案，校验通过后替换草稿。',
    image_import_suggest_region: '按种子颜色提出连通区域轮廓，孔洞另列供校正。',
    image_import_preview: '查看原图、补底或包含真实矢量渲染的重建合成。',
    image_import_build_project: '完整校验并生成独立工程候选，资源权限由宿主提供。',
  } as Record<string, string>)[name], inputSchema: z.toJSONSchema(schema),
}))
