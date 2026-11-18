import { z } from 'zod'
import { captureJson, freezeJson } from '../validation/json.js'
import { createImageCalibration, assertImagePoint, imagePointSchema } from './calibration.js'
import { imageVectorOptionsSchema } from './vector.js'
import { imageSelectionMaskSchema, decodeSelectionMask, assertSelectionMaskBudget } from './selection-mask.js'
import { guidedSelectionSchema } from './guided-selection.js'
import { imageSelectionOriginSchema, assertImageSelectionOrigin, imageSelectionBoundsSchema, visionBoundaryModelSchema } from './selection-origin.js'
import { imageEnhancementDirectionSchema } from '../image-enhancement/schema.js'
import { imageRepairSurfaceSchema, validateImageRepairSurfaces } from './surfaces.js'
import { imageSubjectRefinementSchema, imageSubjectRefinementMasks, validateImageSubjectRefinement } from './subject-refinement.js'
import { imageSurfaceRefinementSchema, validateImageSurfaceRefinement } from './surface-refinement.js'

const points = z.array(imagePointSchema).min(3).max(256)
const donor = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive() })
export const binaryImageScopeSchema = imageSelectionMaskSchema.refine(value => value.runs.every((entry, index) => index % 2 === 0 || entry === 0 || entry === 255),
  '独立移除和保护范围必须为二值覆盖。')
export const imageImportLayerSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(value => value !== '__proto__'),
  name: z.string().trim().min(1).max(120), polygon: points, donor,
  renderLayer: z.enum(['ground', 'object']), blocksMovement: z.boolean(),
  repair: z.enum(['tile', 'seamless', 'aligned', 'texture', 'context', 'context-blend', 'structure', 'surfaces']).optional(),
  appearanceSource: z.enum(['original', 'working']).optional(),
  repairSurfaceIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).min(1).max(16).optional(),
  fills: z.array(z.strictObject({ polygon: points, donor })).max(8).optional(),
  cleanupPx: z.number().int().min(0).max(8).optional(),
  selectionMask: imageSelectionMaskSchema.optional(),
  removalMask: binaryImageScopeSchema.optional(), protectionMask: binaryImageScopeSchema.optional(),
  selectionOrigin: imageSelectionOriginSchema.optional(),
  subjectRefinement: imageSubjectRefinementSchema.optional(),
  surfaceRefinement: imageSurfaceRefinementSchema.optional(),
  guidedSelection: guidedSelectionSchema.optional(),
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
  repairSurfaces: z.array(imageRepairSurfaceSchema).max(16).optional(),
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
  validateImageRepairSurfaces({ width: recipe.image.pixelWidth, height: recipe.image.pixelHeight }, recipe.repairSurfaces ?? [])
  assertSelectionMaskBudget([...recipe.layers.flatMap(layer => [layer.selectionMask, layer.removalMask, layer.protectionMask, layer.surfaceRefinement?.protectionMask, ...imageSubjectRefinementMasks(layer.subjectRefinement)]), ...(recipe.repairSurfaces ?? []).flatMap(s => [s.mask, s.excludedEvidenceMask])])
  for (const point of recipe.roomPointsPx) assertImagePoint(recipe.image, point)
  for (const point of recipe.sourceBoundaryPx ?? []) assertImagePoint(recipe.image, point)
  for (const layer of recipe.layers) {
    validateImageSubjectRefinement({ width: recipe.image.pixelWidth, height: recipe.image.pixelHeight }, layer.subjectRefinement)
    validateImageSurfaceRefinement({ width: recipe.image.pixelWidth, height: recipe.image.pixelHeight }, layer.surfaceRefinement)
    if (layer.surfaceRefinement && (layer.renderLayer !== 'ground' || layer.subjectRefinement || layer.vector)) throw new Error('净毯表面处理只用于独立地面item，不能同时采用主体边带或矢量替换。')
    if (ids.has(layer.id)) throw new Error('拆解物件身份重复。')
    ids.add(layer.id)
    if (layer.repair === 'surfaces' && (!layer.repairSurfaceIds?.length || layer.fills?.length)) throw new Error('按表面补底须指定表面身份，不能同时使用旧分区fills。')
    if (layer.repairSurfaceIds && (new Set(layer.repairSurfaceIds).size !== layer.repairSurfaceIds.length || layer.repairSurfaceIds.some(id => !recipe.repairSurfaces?.some(s => s.id === id)))) throw new Error('物件引用了不存在或重复的补底表面。')
    layer.polygon.forEach(point => assertImagePoint(recipe.image, point))
    if (layer.guidedSelection) {
      const guide = layer.guidedSelection, bounds = guide.bounds
      assertImagePoint(recipe.image, { x: bounds.x, y: bounds.y })
      assertImagePoint(recipe.image, { x: bounds.x + bounds.width, y: bounds.y + bounds.height })
      for (const stroke of [...guide.foreground, ...guide.background]) for (const point of stroke.points) {
        assertImagePoint(recipe.image, point)
        if (point.x < bounds.x || point.y < bounds.y || point.x > bounds.x + bounds.width || point.y > bounds.y + bounds.height) throw new Error('辅助笔迹超出本物件局部范围。')
      }
    }
    for (const mask of [layer.selectionMask, layer.removalMask, layer.protectionMask]) if (mask) decodeSelectionMask(mask, { width: recipe.image.pixelWidth, height: recipe.image.pixelHeight })
    if (layer.removalMask && layer.cleanupPx) throw new Error('独立移除范围不能同时使用残影外扩。')
    if (layer.selectionOrigin) {
      if (!layer.selectionMask) throw new Error('本机候选来源必须伴随确切选区。')
      assertImageSelectionOrigin(layer.selectionOrigin, recipe.image)
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
const visionBoundary = z.strictObject({ ...generation,
  target: z.string().min(1).max(80).optional(), appearanceSource: z.enum(['original', 'working']).default('working'),
  proposalId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/), candidateIndex: z.number().int().min(0).max(31),
  model: visionBoundaryModelSchema, contextBounds: imageSelectionBoundsSchema, targetBounds: imageSelectionBoundsSchema,
  guide: guidedSelectionSchema.optional(),
  roleMapping: z.strictObject({ algorithm: z.literal('polygon-rgb-roles-v1'), boundaryPx: points }).optional(),
}).superRefine((value, context) => {
  if (Boolean(value.guide) === Boolean(value.roleMapping)) context.addIssue({ code: 'custom', message: '视觉提案必须明确选择已有guide或自动RGB角色映射，不能同时提供。' })
  if (value.guide && (value.guide.algorithmVersion !== 2 || !value.guide.boundaryPx)) context.addIssue({ code: 'custom', path: ['guide'], message: '视觉边界提案必须使用算法2并携带粗边界。' })
  const outer = value.contextBounds, target = value.targetBounds
  if (value.guide && (value.guide.bounds.x !== outer.x || value.guide.bounds.y !== outer.y || value.guide.bounds.width !== outer.width || value.guide.bounds.height !== outer.height)) {
    context.addIssue({ code: 'custom', path: ['guide', 'bounds'], message: '视觉提案的guide范围必须与上下文范围一致。' })
  }
  if (target.x < outer.x || target.y < outer.y || target.x + target.width > outer.x + outer.width || target.y + target.height > outer.y + outer.height) {
    context.addIssue({ code: 'custom', path: ['targetBounds'], message: '视觉模型目标范围必须位于上下文范围内。' })
  }
  if (value.roleMapping && (outer.width * outer.height > 250_000 || value.roleMapping.boundaryPx.some(point => point.x < outer.x || point.y < outer.y || point.x > outer.x + outer.width || point.y > outer.y + outer.height))) {
    context.addIssue({ code: 'custom', path: ['roleMapping'], message: 'RGB角色映射粗范围必须在上下文内，计算范围最多25万像素。' })
  }
  if (value.model.provider === 'external' && value.model.disclosure !== 'explicit-image-upload') {
    context.addIssue({ code: 'custom', path: ['model', 'disclosure'], message: '向外部视觉模型发送图片必须有本次明确授权。' })
  }
})
export const imageImportToolArguments = {
  image_import_workflow: z.strictObject({}),
  image_import_export_work: z.strictObject({}),
  image_import_set_checkpoint: z.strictObject({ ...generation, notes: z.string().max(8000), nextAction: z.string().max(2000), scaleStatus: z.enum(['provisional', 'measured']) }),
  image_import_guided_selection: z.strictObject({ ...generation, target: z.string().min(1).max(80).optional(), guide: guidedSelectionSchema }),
  image_import_vision_boundary: visionBoundary,
  image_import_set_selection: z.strictObject({ ...generation, target: z.string().min(1).max(80), selectionMask: imageSelectionMaskSchema, selectionOrigin: imageSelectionOriginSchema }),
  image_import_set_repair_scope: z.strictObject({ ...generation, target: z.string().min(1).max(80),
    removalMask: binaryImageScopeSchema.nullable(), protectionMask: binaryImageScopeSchema.nullable(),
    donor: donor.optional(), repair: imageImportLayerSchema.shape.repair }),
  image_import_item_preview: z.strictObject({ target: z.string().min(1).max(80) }),
  image_import_analyze_repair: z.strictObject({ target: z.string().min(1).max(80), surfaceId: z.string().min(1).max(80).optional() }),
  image_import_enhancement_candidates: z.strictObject({ target: z.string().min(1).max(80), direction: imageEnhancementDirectionSchema,
    count: z.union([z.literal(2), z.literal(3)]), scale: z.union([z.literal(1), z.literal(2)]).optional() }),
  image_import_matte_candidates: z.strictObject({ target: z.string().min(1).max(80),
    count: z.union([z.literal(2), z.literal(3)]), bandPx: z.union([z.literal(1), z.literal(2)]).optional() }),
  image_import_subject_candidates: z.strictObject({ target: z.string().min(1).max(80), count: z.union([z.literal(2), z.literal(3)]), method: imageSubjectRefinementSchema.shape.method.optional(), bandPx: z.union([z.literal(1), z.literal(2)]).default(1),
    referenceGuidance: imageSubjectRefinementSchema.shape.referenceGuidance.unwrap().nullable().optional(),
    foregroundProtectionMask: imageSubjectRefinementSchema.shape.foregroundProtectionMask.unwrap().nullable().optional(),
    excludedEvidenceMask: imageSubjectRefinementSchema.shape.excludedEvidenceMask.unwrap().nullable().optional() }),
  image_import_set_subject_refinement: z.strictObject({ ...generation, target: z.string().min(1).max(80), inputHash: z.string().regex(/^[a-f0-9]{64}$/), refinement: imageSubjectRefinementSchema.nullable() }),
  image_import_surface_candidate: z.strictObject({ target: z.string().min(1).max(80), refinement: imageSurfaceRefinementSchema }),
  image_import_set_surface_refinement: z.strictObject({ ...generation, target: z.string().min(1).max(80), inputHash: z.string().regex(/^[a-f0-9]{64}$/), refinement: imageSurfaceRefinementSchema.nullable() }),
  image_import_review_item: z.strictObject({ ...generation, target: z.string().min(1).max(80), inputHash: z.string().regex(/^[a-f0-9]{64}$/), verdict: z.enum(['needs-work', 'reviewed']), note: z.string().min(1).max(2000) }),
  image_import_inspect: z.strictObject({}),
  image_import_set_scale: calibrationSchema.extend(generation),
  image_import_set_room: z.strictObject({ ...generation, points }),
  image_import_set_source_boundary: z.strictObject({ ...generation, points }),
  image_import_set_output_scale: z.strictObject({ ...generation, scale: z.union([z.literal(1), z.literal(2), z.literal(4)]) }),
  image_import_set_surfaces: z.strictObject({ ...generation, surfaces: z.array(imageRepairSurfaceSchema).max(16) }),
  image_import_extract_item: imageImportLayerSchema.extend(generation),
  image_import_refine_selection: z.strictObject({ ...generation, target: z.string().min(1).max(80),
    strokes: z.array(z.strictObject({ mode: z.enum(['keep', 'remove']), points: z.array(imagePointSchema).min(1).max(512), radiusPx: z.number().finite().min(.5).max(64) })).max(64),
    contour: z.strictObject({ points: z.array(imagePointSchema).min(3).max(512), radiusPx: z.number().int().min(1).max(32).optional() }).optional(),
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
    image_import_surface_candidate: '只读生成净毯面色、同材质细纹和原布缝候选。仅独立地面item；保留alpha及外沿3px，内部属推断。底色细纹只用未移除/排除的干净原图；显式布缝可读取家具轮廓外带阴影的原笔迹，仅供分离窄墨，不能转为干净底材取证。短遮挡连接有界推断，未决给局部范围。',
    image_import_set_surface_refinement: '实际审阅净毯候选后，以当前inputHash和代次原子采用cloth-surface-v1；null恢复原裁片。仅改变该item外观，不改选区/背景移除/保护/占地；工作包保存配方可冷重放，原图保真仅限基线。',
    image_import_workflow: '读取通用制作流程、恢复状态、下一步与已失效复核；新任务先调用。',
    image_import_export_work: '保存独立制作工作包，包含原图、辅助输入和断点；普通工程不包含这些制作资料。',
    image_import_set_checkpoint: '记录尚未解决的问题、下一操作与暂定/实测比例，不授予视觉通过。',
    image_import_guided_selection: '在局部粗框中用少量前景/背景笔迹生成多色与边缘约束选区。新请求默认算法2；建议显式edgeCoverage:boundary防止内部半透明，回传guide供保存。旧配方未写版本仍按算法1重放，缺edgeCoverage保持旧边缘。未指定target时只返回候选；指定已有item时原子重放后更新。',
    image_import_vision_boundary: '接收视觉模型对当前原图提出的粗边界。明确二选一：guide提供少量前景/背景点，或roleMapping:{algorithm:polygon-rgb-roles-v1,boundaryPx}按真实内外RGB对比自动提出至多3前景/4背景角色，再运行同一算法2图割；自动角色不证明语义归属，弱依据拒绝。只读、不自动采用、不按confidence选最高项；返回实际guide、selectionMask、uncertainMask和可离线重放的模型来源。外部模型必须有本次明确图片上传授权；没有授权时使用本机/自托管模型或改用页面人工辅助。候选随后交给extract_item或set_selection。',
    image_import_set_selection: '将已查看的本机模型候选选区用于已有物件，保留确切来源、点与模型摘要；按当前代次原子重放，不修改源RGB或授予视觉通过。新物件用extract_item携带相同selectionMask及selectionOrigin。',
    image_import_set_repair_scope: '独立设置物件移除和邻物保护蒙版；null清除该范围，可同时选择取样和方式。移除须覆盖物件、保护不得与物件冲突；保护区不写入或作为取样证据。重放后一次采用，可撤销。context只用单材质完整取样补片；显式context-blend沿实际移除边界衔接颜色，保留原尺寸纹理梯度，保护和前序推断不得取证。两者均不恢复未知细节，旧配方不自动升级。',
    image_import_item_preview: '读取指定item的400%黑底/白底/棋盘预览与确切输入、PNG及补底摘要，供真实视觉复核。',
    image_import_analyze_repair: '只读分析指定物件的实际补底，按显式同材质表面比较附近可信原始小块，解释候选颜色/梯度/纹理/结构差异，定位冲突并给出一小处人工辅助操作。可选surfaceId指定实际参与的guided底材，底色/笔迹每次只额外检查这一块；省略检查移除最多的一块，其他明确未查。返回确切输入/补底/报告/审阅PNG摘要；分数不是通过概率，不自动采用或写审核。未分材质时先指引圈范围，不靠颜色猜语义。',
    image_import_enhancement_candidates: '从实际保真裁片生成2/3个独立增强候选及换底预览，返回确切源/参数/PNG摘要。只读，不替换原裁片或修改工程；选定后在统一素材页按同配方审阅采用。插值不恢复细节。',
    image_import_matte_candidates: '从实际原图上下文与当前选区生成2/3个只读边带分色候选和换底图。只在既有半透明边及稳定可见底材处估计前景RGB，alpha和核心不变；二值边缘无依据时保持不变，零变化不算改善。前序推断和保护区不作外侧取证，不上传原图或采用到工程。配方需原图上下文，不等同普通裁片增强。',
    image_import_subject_candidates: '只读生成原裁片、覆盖阶段和最终派生及换底图。subject-contour-v1仅处理二值选区与不透明原前景，内外各1px，面积补偿不保证每处，外圈位置属推断，尚未去混色。subject-matte-v1在内1/2px以可信F/B联合估计alpha/RGB，弱依据不改。subject-reference-v1须referenceGuidance:{base:original|contour,foreground,background,mixed}，三者为原坐标二值RLE；仅尝试明确mixed边，未标记保持基线，几何基线与颜色取证分开，参考每类3–64像素且框≤4096、距处理处≤64px，背景在实际移除外。标记角色仍是人工推断，不自动传播或识别真实灰边。所有方法保护核心/细杆/孔洞/主体保护/邻物；方法省略沿用已采用，否则旧matte，页面默认不变。辅助省略沿用、null清除；切换到其他方法清除旧referenceGuidance，完整蒙版预算继续检查。按同原图网格审阅，物理占地保持，输入变化重算，成功不授予视觉通过。',
    image_import_set_subject_refinement: '查看主体阶段候选后，以确切inputHash和当前代次原子采用显式subject-contour-v1、subject-matte-v1或带完整referenceGuidance的subject-reference-v1配方；null恢复原裁片。保留原选区/原图/补底/物理占地及基线保真证据，contour允许外侧1px位置推断，不能称支撑范围不变；派生另审。同一严格工作包v1保存参考/角色/保护与配方可重放，普通工程保存实际派生素材及来源，不嵌入制作记录。',
    image_import_review_item: '将助手的视觉复核绑定当前确切候选摘要；不代表用户签收，输入变化后失效。',
    image_import_inspect: '读取已授权原图身份、当前拆解草稿和代次。',
    image_import_set_scale: '用原图两点和实际毫米距离设置比例。',
    image_import_set_room: '设置房间地面内边界。保全原画墙沿和家具最外沿另用set_source_boundary；每件guide.boundaryPx只是局部分割限制。',
    image_import_set_source_boundary: '设置整间原画保留外框，包含墙沿、叶尖及家具最外沿，排除图外棋盘。未设置时只能保留room内。完成范围和比例后先assess_fidelity预检再拆第一件。',
    image_import_set_output_scale: '设置1/2/4倍原色像素输出，不调色、不重画、不声称恢复原图缺失的细节。',
    image_import_set_surfaces: '原子定义同材质表面、干净取样及禁止取证范围，重放受影响物件；guided类型须显式提供方向和有限结构引导及各自可见可信参考。引导改变隐藏结构推断，分数不授予视觉通过；每个物件显式引用下层表面身份，改变后重新审核。',
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
