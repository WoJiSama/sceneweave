import { z } from 'zod'
import { directedInteriorLayoutParametersSchema } from './domains/interior/contracts.js'
import { AUTOMATIC_ROAD_MAX_FIXED_POINTS, ROAD_LANDING_MIN_MM, ROAD_LANDING_MAX_MM } from '../geometry/road-surface.js'
import { commandSelectionLimit } from '../budget/command-budget.js'
import { ART_STYLE_PRESETS } from '../visual/art-style.js'
import { captureJson } from '../validation/json.js'

export const MAP_AUTHORING_WORKFLOW = 'sceneweave-map-authoring'

const id = z.string().min(1).max(120).refine(value => !Object.hasOwn(Object.prototype, value), 'ID 不可使用保留属性名')
const targetId = z.string().min(1).max(256).refine(value => !Object.hasOwn(Object.prototype, value), 'ID 不可使用保留属性名')
const label = z.string().trim().min(1).max(120)
const integer = z.number().int().min(-1_000_000).max(1_000_000)
const width = z.number().int().min(100).max(12000)
const point = z.object({ x: integer, y: integer }).strict()
const ring = z.array(point).min(3).max(2048)
const line = z.array(point).min(2).max(128)
const ground = z.object({ kind: z.literal('terrainArea'), id }).strict()
const support = z.union([ground, z.object({ kind: z.literal('room'), id }).strict()])
const end = z.object({ at: point, support: support.optional() }).strict()
const placement = { material: id.optional(), layerId: id.optional() }
const radius = z.object({ x: integer.positive(), y: integer.positive() }).strict()
const ellipse = { at: point, radius }
const side = z.enum(['north', 'east', 'south', 'west'])
const around = z.object({ landmarkId: id, side, radiusMm: z.number().int().min(1000).max(60000).optional() }).strict()
const localRegion = z.union([
  z.object({ boundary: ring.max(128) }).strict(),
  z.object(ellipse).strict(),
])
const coverKind = z.enum(['grass', 'sand', 'rock'])
const artStyle = z.enum(['original', ...ART_STYLE_PRESETS])
const coverZone = z.object({ id, areaId: id, region: localRegion, cover: coverKind })
const sceneryZone = z.object({ id, areaId: id, region: localRegion,
  palette: z.enum(['woodland', 'scrub', 'stone']).default('woodland'), density: z.number().min(0).max(1).default(.86),
  pattern: z.enum(['meadow', 'grove']).optional() }).strict()
const routeAnchor = z.object({ at: point, elevationMm: integer.optional(),
  landingMm: z.number().int().min(ROAD_LANDING_MIN_MM).max(ROAD_LANDING_MAX_MM).optional() }).strict()
const land = z.object({ id, boundary: ring.optional(), at: point.optional(), radius: radius.optional(),
  form: z.enum(['natural', 'flat', 'reef']).default('natural'), shore: z.enum(['natural', 'hard', 'none']).default('natural'),
  outline: z.enum(['exact', 'smooth', 'traced']).default('exact'),
  cover: z.enum(['natural', 'grass', 'sand', 'rock']).default('natural'), elevationMm: integer.min(-30000).max(30000).optional() }).strict()
  .refine(row => row.boundary ? !row.at && !row.radius : !!row.at && !!row.radius, '给出轮廓，或同时给出中心和半径。')
export const MAP_STRUCTURE_POINTS = 48
export const MAP_SHALLOW_POINTS = 128
const shapeLine = line.max(MAP_STRUCTURE_POINTS)
const landformStructure = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('area'), boundary: ring.max(MAP_STRUCTURE_POINTS), breakline: shapeLine.optional() }).strict(),
  z.object({ kind: z.literal('ridge'), centerline: shapeLine, breakline: shapeLine.optional() }).strict(),
])
const shallowZone = z.object({ id, boundary: ring.max(MAP_SHALLOW_POINTS) }).strict()
const landform = z.object({ id, areaId: id, name: label.optional(), ...ellipse,
  shape: z.enum(['hill', 'ridge', 'lowland', 'plateau']), elevationMm: integer.min(-30000).max(30000),
  cover: coverKind.optional(), keepClear: z.boolean().optional(), preserveRelief: z.literal(true).optional(), structure: landformStructure.optional(),
  rotationDeg: z.number().min(0).lt(360).default(0) }).strict()
  .refine(row => row.shape !== 'lowland' || !row.preserveRelief, '保留凸起用于山丘、山脊或台地。')
const routeFields = { id, areaId: id, around: around.optional(), widthMm: width.max(6000).default(2000),
  style: z.enum(['trail', 'stairs']).default('trail') }
const fixedLandscapeRoute = z.object({ ...routeFields, via: z.array(routeAnchor).min(2).max(AUTOMATIC_ROAD_MAX_FIXED_POINTS) }).strict()
  .refine(row => !row.around || row.via.length === 2, { path: ['via'], message: '按方向绕行时，只提供起点和终点，程序会补充转折。' })
const ascentRoute = z.object({ ...routeFields, style: z.enum(['trail', 'stairs']).default('stairs'),
  ascent: z.object({ from: z.object(ellipse).strict(), toLandmarkId: id, minRiseMm: integer.positive().max(60000).default(1200),
    minWidthMm: width.max(6000).optional(),
    staircase: z.enum(['terrain', 'flight']).default('terrain') }).strict(),
}).strict().refine(row => row.ascent.minWidthMm === undefined || row.ascent.minWidthMm <= row.widthMm,
  { path: ['ascent', 'minWidthMm'], message: '可接受净宽下限不能大于首选净宽。' })
const landscapeRoute = z.union([fixedLandscapeRoute, ascentRoute])
export const MAP_LANDSCAPE_LIMITS = { land: 48, landforms: 32, lakes: 16, shallows: 8, routes: 12, scenery: 12, covers: 32 } as const
const landscapeRecipe = z.object({ kind: z.literal('landscape'), environment: z.enum(['coast', 'upland']).default('upland'),
  land: z.array(land).min(1).max(MAP_LANDSCAPE_LIMITS.land), landforms: z.array(landform).max(MAP_LANDSCAPE_LIMITS.landforms).default([]),
  lakes: z.array(z.object({ id, areaId: id, boundary: ring }).strict()).max(MAP_LANDSCAPE_LIMITS.lakes).optional(),
  shallows: z.array(shallowZone).max(MAP_LANDSCAPE_LIMITS.shallows).optional(),
  routes: z.array(landscapeRoute).max(MAP_LANDSCAPE_LIMITS.routes).default([]), scenery: z.array(sceneryZone).max(MAP_LANDSCAPE_LIMITS.scenery).default([]),
  covers: z.array(coverZone.strict()).max(MAP_LANDSCAPE_LIMITS.covers).default([]),
  density: z.number().min(0).max(1).default(.64),
  finish: z.literal('natural').optional(),
  style: artStyle.default('original') }).strict()
export type MapLandscapeRecipe = z.infer<typeof landscapeRecipe>
export type MapLandscapeRoute = z.infer<typeof landscapeRoute>
export type MapAscentRoute = z.infer<typeof ascentRoute>
export type MapSceneryZone = z.infer<typeof sceneryZone>
export type MapCoverZone = z.infer<typeof coverZone>
export type MapShallowZone = z.infer<typeof shallowZone>
export type MapLandform = z.infer<typeof landform>
export type MapLandformStructure = z.infer<typeof landformStructure>

export const MAP_REFERENCE_TOLERANCE = 28
export const MAP_REFERENCE_DEFAULTS = { backgroundSamples: 12, detailSamples: 24, correctionStrokes: 24, strokePoints: 96, longEdgeMm: 78_000 } as const
const referenceStroke = z.object({ points: z.array(point).min(1).max(MAP_REFERENCE_DEFAULTS.strokePoints),
  radiusPx: z.number().int().min(1).max(128), kind: z.enum(['land', 'background']) }).strict()
const referenceLandmarkInput = z.object({ ...landform.shape, areaId: id.optional(), radius: radius.optional() }).strict()
const referenceAscentInput = z.object({
  id, widthMm: routeFields.widthMm, style: ascentRoute.shape.style,
  from: point, radius: radius.optional(), to: id, around: side.optional(),
  minRiseMm: ascentRoute.shape.ascent.shape.minRiseMm, minWidthMm: ascentRoute.shape.ascent.shape.minWidthMm,
  staircase: ascentRoute.shape.ascent.shape.staircase,
}).strict()
const referenceDesign = z.object({
  longEdgeMm: z.number().int().min(1000).max(120000).optional(),
  seed: label.optional(),
  landforms: z.array(referenceLandmarkInput).max(MAP_LANDSCAPE_LIMITS.landforms).default([]),
  ascents: z.array(referenceAscentInput).max(MAP_LANDSCAPE_LIMITS.routes).default([]),
  shallows: z.array(shallowZone).max(MAP_LANDSCAPE_LIMITS.shallows).optional(),
}).strict()
export const mapReferenceSchema = z.object({
  title: label.default('参考图地形'),
  environment: z.enum(['coast', 'upland']).default('coast'),
  background: z.array(point).min(1).max(MAP_REFERENCE_DEFAULTS.backgroundSamples),
  foreground: z.array(point).max(MAP_REFERENCE_DEFAULTS.detailSamples).default([]),
  keep: z.array(point).max(MAP_REFERENCE_DEFAULTS.detailSamples).default([]),
  shallow: z.array(point).max(MAP_REFERENCE_DEFAULTS.detailSamples).default([]),
  omit: z.array(point).max(MAP_REFERENCE_DEFAULTS.detailSamples).default([]),
  corrections: z.array(referenceStroke).max(MAP_REFERENCE_DEFAULTS.correctionStrokes).default([]),
  tolerance: z.number().min(8).max(90).default(MAP_REFERENCE_TOLERANCE),
  detail: z.enum(['coarse', 'balanced', 'fine']).default('balanced'),
  surfaceFromReference: z.boolean().default(true),
  structureFromReference: z.boolean().default(true),
  shorelineFromReference: z.boolean().default(true),
  design: referenceDesign.optional(),
}).strict()

const interior = directedInteriorLayoutParametersSchema.shape
const recipeSchema = z.discriminatedUnion('kind', [
  landscapeRecipe,
  z.object({ kind: z.literal('layout'), palette: z.enum(['starter', 'interior', 'coast', 'forest']).default('starter') }).strict(),
  z.object({ kind: z.literal('interior'), rooms: z.array(z.object({ id, purpose: label,
    minAreaM2: z.number().positive().max(10000).default(9), minClearSideMm: width.default(1800) }).strict()).min(1).max(24),
  relations: interior.relations.default([]), entranceRoom: id.optional(), furniture: z.boolean().default(true),
  clearWidthMm: width.max(5000).default(1100), corridor: interior.corridor.optional() }).strict(),
  z.object({ kind: z.literal('forest'), entranceSide: z.enum(['west', 'east', 'north', 'south']).default('west'),
    density: z.number().min(0).max(2).default(1), routeWidthMm: width.max(5000).default(1400),
    clearings: z.array(z.object({ id, boundsMm: z.object({ x: integer.nonnegative(), y: integer.nonnegative(),
      width: integer.positive(), height: integer.positive() }).strict() }).strict()).max(6).optional() }).strict(),
  z.object({ kind: z.literal('volcano'), mountainElevationMm: integer.positive().default(6200),
    craterElevationMm: integer.default(700), routeWidthMm: width.max(5000).default(1500),
    connection: z.enum(['stairs', 'ramp']).default('stairs'), lava: z.enum(['none', 'cold', 'hot']).default('cold') }).strict(),
  z.object({ kind: z.literal('mixed'), environment: z.enum(['forest', 'volcano']).default('forest'),
    purpose: label.default('休息室'), roomCount: z.number().int().min(1).max(4).default(2), furniture: z.boolean().default(true),
    vegetationMultiplier: z.number().min(0).max(2).default(1) }).strict(),
  z.object({ kind: z.enum(['island', 'coast']) }).strict(),
])

const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terrain'), id, boundary: ring, elevationMm: integer.default(0),
    priority: z.number().int().min(-10000).max(10000).default(1), blocksMovement: z.boolean().default(false), ...placement }).strict(),
  z.object({ kind: z.literal('room'), id, boundary: ring.max(256), purpose: label,
    thicknessMm: width.max(2000).default(180), support: ground.optional(), ...placement }).strict(),
  z.object({ kind: z.literal('path'), id, points: line, widthMm: width.default(1200),
    supports: z.array(support).min(1).max(16).optional(), ...placement }).strict(),
  z.object({ kind: z.literal('connection'), id, style: z.enum(['stairs', 'ramp']).default('stairs'), from: end, to: end,
    widthMm: width.default(1200), layerId: id.optional() }).strict(),
  z.object({ kind: z.literal('prop'), id, definitionId: id, at: point, support: support.optional(),
    rotationDeg: z.number().min(0).lt(360).default(0), layerId: id.optional() }).strict(),
  z.object({ kind: z.literal('opening'), id, wallId: id, fromVertexId: id, offsetMm: integer.nonnegative(),
    widthMm: width.max(5000).default(1100), style: z.enum(['door', 'window']).default('door') }).strict(),
  z.object({ kind: z.literal('terrain-update'), id, boundary: ring.optional(), elevationMm: integer.optional() }).strict()
    .refine(value => value.boundary !== undefined || value.elevationMm !== undefined, '提供轮廓或高程'),
  z.object({ kind: z.literal('terrain-shape'), id, at: point, radiusMm: integer.min(350).max(15000),
    deltaMm: integer.min(-6000).max(6000) }).strict(),
  z.object({ kind: z.literal('scenery-density'), id: targetId, density: z.number().min(0).max(1) }).strict(),
  sceneryZone.extend({ kind: z.literal('scenery-zone') }),
  coverZone.extend({ kind: z.literal('cover-zone') }).strict(),
  z.object({ kind: z.literal('art-style'), id: z.literal('scene').default('scene'), style: artStyle }).strict(),
  z.object({ kind: z.literal('path-update'), id, points: line.optional(), widthMm: width.optional(), around: around.optional() }).strict()
    .refine(value => value.points !== undefined || value.widthMm !== undefined || value.around !== undefined, '提供路线、宽度或绕行方向。')
    .refine(value => !value.around || !value.points || value.points.length === 2, { path: ['points'], message: '按方向绕行时，省略 points 沿用起终点，或只提供两个新端点。' }),
  z.object({ kind: z.literal('prop-move'), id, at: point, rotationDeg: z.number().min(0).lt(360).optional() }).strict(),
  z.object({ kind: z.literal('room-purpose'), id, purpose: label }).strict(),
  z.object({ kind: z.literal('room-move'), id, offsetMm: point, openingsToMove: z.array(id).max(256).default([]) }).strict(),
  z.object({ kind: z.literal('vertex-move'), id, at: point }).strict(),
  z.object({ kind: z.literal('opening-move'), id, wallId: id, fromVertexId: id, offsetMm: integer.nonnegative(),
    widthMm: width.max(5000).optional() }).strict(),
  z.object({ kind: z.literal('connection-update'), id, from: end.optional(), to: end.optional(), widthMm: width.optional() }).strict()
    .refine(value => value.from !== undefined || value.to !== undefined || value.widthMm !== undefined, '提供落脚点或宽度'),
])

const shared = {
  referenceSizePx: z.object({ width: z.number().int().positive().max(32000), height: z.number().int().positive().max(32000) }).strict().optional(),
  checks: z.array(z.object({ id, points: line, widthMm: width, required: z.boolean().default(true) }).strict()).max(8).default([]),
  heightChecks: z.array(z.object({ id, low: point, high: point, minRiseMm: integer.positive(), required: z.boolean().default(true) }).strict()).max(8).default([]),
  oblique: z.boolean().optional(),
}
const dimension = z.number().int().min(1000).max(120000)
const referenceScale = z.object({ from: point, to: point, lengthMm: integer.positive() }).strict()
export const MAP_OPERATION_LIMIT = commandSelectionLimit()
export const mapGenerateSchema = z.object({
  title: label, widthMm: dimension.optional(), heightMm: dimension.optional(), referenceScale: referenceScale.optional(),
  seed: label.default('sceneweave'), recipe: recipeSchema.default({ kind: 'layout', palette: 'starter' }),
  operations: z.array(operationSchema).max(MAP_OPERATION_LIMIT).default([]), ...shared,
}).strict().superRefine((request, context) => {
  const { recipe, referenceScale, referenceSizePx } = request
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message })
  if (referenceScale) {
    const fits = ({ x, y }: z.infer<typeof point>) => referenceSizePx && x >= 0 && y >= 0 && x <= referenceSizePx.width && y <= referenceSizePx.height
    if (recipe.kind !== 'landscape' || request.widthMm !== undefined || request.heightMm !== undefined
      || !fits(referenceScale.from) || !fits(referenceScale.to)
      || referenceScale.from.x === referenceScale.to.x && referenceScale.from.y === referenceScale.to.y) {
      issue('referenceScale', '参考图标尺适用于 landscape：提供图内两个不同的点和实际距离，画布尺寸由标尺计算。')
      return
    }
  }
  const { widthMm, heightMm } = mapDimensions(request)
  if (!dimension.safeParse(widthMm).success || !dimension.safeParse(heightMm).success) issue('referenceScale', '换算后每轴须在 1–120 米之间。')
  if (Math.max(widthMm, heightMm) > Math.min(widthMm, heightMm) * 20) {
    context.addIssue({ code: 'custom', path: ['heightMm'], message: '画布长宽比最多为20:1。' })
  }
  if ((recipe.kind === 'island' || recipe.kind === 'coast') && (widthMm < 24000 || heightMm < 18000 || heightMm > 90000 || widthMm < heightMm || widthMm > heightMm * 1.8)) {
    context.addIssue({ code: 'custom', path: ['recipe'], message: '岩岛和海岸配方需要至少 24×18 米、宽高比 1–1.8，高度最多 90 米。' })
  }
  if (recipe.kind === 'layout' && !request.operations.length) {
    context.addIssue({ code: 'custom', path: ['operations'], message: '自由构图至少需要一项操作。' })
  }
  if (recipe.kind === 'landscape') {
    const areaIds = new Set(recipe.land.map(row => row.id))
    const features = [...recipe.landforms, ...recipe.routes, ...recipe.scenery, ...recipe.covers, ...(recipe.lakes ?? [])]
    const ids = [...recipe.land, ...features, ...(recipe.shallows ?? [])].map(row => row.id)
    if (new Set(ids).size !== ids.length || ids.some(value => value.startsWith('landscape/'))) issue('recipe', '地形、地貌、路线、地表覆盖与布景 ID 须唯一。landscape/ 留给程序派生对象。')
    if ((recipe.lakes?.length || recipe.shallows?.length) && recipe.environment !== 'coast') issue('recipe', '内水及浅水轮廓使用 coast 水岸环境。')
    for (const row of features) if (!areaIds.has(row.areaId)) issue('recipe', `「${row.id}」引用了不存在的陆地「${row.areaId}」。`)
    for (const route of recipe.routes) if (route.around && !recipe.landforms.some(row => row.id === route.around?.landmarkId && row.areaId === route.areaId)) {
      issue('recipe', `路线「${route.id}」需指定同一块陆地内的地貌作为绕行地标。`)
    }
    for (const route of recipe.routes) if ('ascent' in route && !recipe.landforms.some(row =>
      row.id === route.ascent.toLandmarkId && row.areaId === route.areaId && row.shape !== 'lowland')) {
      issue('recipe', `路线「${route.id}」的终点须是同一块陆地内的高处地标。`)
    }
  }
})
export const mapEditSchema = z.object({
  projectHash: z.string().regex(/^[a-f0-9]{64}$/), floorId: id,
  operations: z.array(operationSchema).min(1).max(MAP_OPERATION_LIMIT), ...shared,
  referenceMapping: z.enum(['stretch', 'fit']).default('stretch'),
}).strict()
export const mapInspectSchema = z.object({
  floorId: id.optional(), query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(100).default(24),
  offset: z.number().int().min(0).max(100000).default(0),
}).strict()

export type MapGenerateRequest = z.infer<typeof mapGenerateSchema>
export type MapEditRequest = z.infer<typeof mapEditSchema>
export type MapInspectRequest = z.infer<typeof mapInspectSchema>
export type MapOperation = z.infer<typeof operationSchema>
export type MapRouteCheck = MapGenerateRequest['checks'][number]
export const parseMapGenerate = (input: unknown) => mapGenerateSchema.parse(captureJson(input))
export const parseMapEdit = (input: unknown) => mapEditSchema.parse(captureJson(input))
export const parseMapInspect = (input: unknown) => mapInspectSchema.parse(captureJson(input))
export const parseMapReference = (input: unknown) => mapReferenceSchema.parse(captureJson(input))

export function mapDimensions(request: Pick<MapGenerateRequest, 'recipe' | 'widthMm' | 'heightMm' | 'referenceScale' | 'referenceSizePx'>) {
  const { widthMm, heightMm, recipe, referenceSizePx, referenceScale } = request
  if (recipe.kind !== 'landscape') return { widthMm: widthMm ?? 40000, heightMm: heightMm ?? 32000 }
  if (!referenceSizePx) return { widthMm: widthMm ?? 64000, heightMm: heightMm ?? 48000 }
  const { width, height } = referenceSizePx
  if (referenceScale) {
    const { from, to, lengthMm } = referenceScale
    const scale = lengthMm / Math.hypot(from.x - to.x, from.y - to.y)
    return { widthMm: Math.round(width * scale), heightMm: Math.round(height * scale) }
  }
  const scale = widthMm ? widthMm / width : heightMm ? heightMm / height : MAP_REFERENCE_DEFAULTS.longEdgeMm / Math.max(width, height)
  return { widthMm: widthMm ?? Math.round(width * scale), heightMm: heightMm ?? Math.round(height * scale) }
}

const examples = {
  'landscape-ascent': { title: '河岸瞭望坡', widthMm: 58000, heightMm: 42000, oblique: true,
    recipe: { kind: 'landscape', finish: 'natural', land: [
      { id: 'slope', at: { x: 500, y: 500 }, radius: { x: 490, y: 460 } },
    ], landforms: [
      { id: 'summit', name: '瞭望台地', areaId: 'slope', shape: 'plateau', at: { x: 635, y: 455 },
        radius: { x: 216, y: 254 }, elevationMm: 7200, cover: 'grass' },
      { id: 'foot', name: '河岸低地', areaId: 'slope', shape: 'lowland', at: { x: 315, y: 610 },
        radius: { x: 105, y: 132 }, elevationMm: 500, cover: 'sand' },
    ], routes: [
      { id: 'ascent', areaId: 'slope', widthMm: 1500, style: 'stairs',
        ascent: { from: { at: { x: 315, y: 610 }, radius: { x: 57, y: 64 } }, toLandmarkId: 'summit', minRiseMm: 6000 },
        around: { landmarkId: 'summit', side: 'north' } },
    ] } },
  'landscape-reference': { title: '北岬瞭望站', referenceSizePx: { width: 800, height: 600 }, oblique: true,
    recipe: { kind: 'landscape', environment: 'coast',
      land: [{ id: 'headland', outline: 'smooth', boundary: [
        { x: 85, y: 490 }, { x: 64, y: 352 }, { x: 152, y: 222 }, { x: 368, y: 210 },
        { x: 453, y: 125 }, { x: 686, y: 102 }, { x: 744, y: 289 }, { x: 658, y: 465 },
        { x: 463, y: 405 }, { x: 283, y: 520 },
      ] }],
      landforms: [{ id: 'summit', name: '北岬峰顶', areaId: 'headland', shape: 'hill', at: { x: 552, y: 260 },
        radius: { x: 152, y: 125 }, elevationMm: 6800 },
      { id: 'beach', name: '西湾低滩', areaId: 'headland', shape: 'lowland', at: { x: 234, y: 373 },
        radius: { x: 112, y: 84 }, elevationMm: 750, cover: 'sand' }],
      routes: [{ id: 'ascent', areaId: 'headland', widthMm: 1500, style: 'stairs',
        via: [{ at: { x: 355, y: 321 } }, { at: { x: 552, y: 260 } }], around: { landmarkId: 'summit', side: 'north' } }],
      covers: [{ id: 'west-grass', areaId: 'headland', cover: 'grass', region: { at: { x: 246, y: 290 }, radius: { x: 77, y: 52 } } }],
      scenery: [{ id: 'west-woods', areaId: 'headland', pattern: 'grove', region: { at: { x: 246, y: 290 }, radius: { x: 73, y: 46 } } }],
    } },
  landscape: { title: '风口瞭望径', widthMm: 56000, heightMm: 42000, recipe: { kind: 'landscape', environment: 'upland',
    land: [{ id: 'upland', at: { x: 510, y: 490 }, radius: { x: 460, y: 440 } }],
    landforms: [{ id: 'summit', name: '瞭望空地', areaId: 'upland', shape: 'hill', at: { x: 620, y: 390 },
      radius: { x: 265, y: 320 }, elevationMm: 5400 }],
    routes: [{ id: 'lookout-trail', areaId: 'upland', style: 'stairs', widthMm: 2000, via: [
      { at: { x: 235, y: 695 } }, { at: { x: 448, y: 690 } },
      { at: { x: 668, y: 645 } }, { at: { x: 780, y: 481 } },
      { at: { x: 735, y: 320 } }, { at: { x: 620, y: 390 } },
    ] }] }, oblique: true },
  interior: { title: '驿站诊所', widthMm: 26000, heightMm: 18000,
    recipe: { kind: 'interior', entranceRoom: 'reception', furniture: false,
      rooms: [{ id: 'reception', purpose: '接待室' }, { id: 'ward', purpose: '病房', minAreaM2: 16 }],
      relations: [{ a: 'reception', b: 'ward', kind: 'adjacent', minimumSharedWallMm: 2200 }] } },
  forest: { title: '林中营地', recipe: { kind: 'forest', entranceSide: 'south' } },
  volcano: { title: '火口调查站', recipe: { kind: 'volcano' }, oblique: true },
  mixed: { title: '林中哨站', recipe: { kind: 'mixed' } },
  island: { title: '潮环岩岛', recipe: { kind: 'island' } },
  coast: { title: '海崖小径', recipe: { kind: 'coast' } },
  layout: { title: '浅湾瞭望站', widthMm: 28000, heightMm: 20000, recipe: { kind: 'layout', palette: 'coast' }, oblique: true,
    referenceSizePx: { width: 280, height: 200 },
    operations: [
      { kind: 'terrain', id: 'water', boundary: [{ x: 0, y: 0 }, { x: 280, y: 0 }, { x: 280, y: 200 }, { x: 0, y: 200 }], material: 'water', blocksMovement: true },
      { kind: 'terrain', id: 'land', boundary: [{ x: 18, y: 35 }, { x: 248, y: 32 }, { x: 251, y: 105 }, { x: 172, y: 105 }, { x: 167, y: 159 }, { x: 22, y: 183 }],
        material: 'grass', elevationMm: 400, priority: 2 },
      { kind: 'room', id: 'station', purpose: '瞭望室', boundary: [{ x: 48, y: 63 }, { x: 108, y: 63 }, { x: 108, y: 106 }, { x: 48, y: 106 }],
        material: 'sand', support: { kind: 'terrainArea', id: 'land' } },
      { kind: 'path', id: 'track', points: [{ x: 80, y: 129 }, { x: 134, y: 124 }, { x: 145, y: 73 }], widthMm: 1200,
        material: 'sand', supports: [{ kind: 'terrainArea', id: 'land' }] },
    ],
    checks: [{ id: 'coastal-track', points: [{ x: 80, y: 129 }, { x: 134, y: 124 }, { x: 145, y: 73 }], widthMm: 1100 }] },
} satisfies Record<string, z.input<typeof mapGenerateSchema>>

export function mapAuthoringExample(kind = 'interior') {
  if (!Object.hasOwn(examples, kind)) throw new Error(`未知示例 ${kind}。可用：${Object.keys(examples).join(', ')}。`)
  return captureJson(examples[kind as keyof typeof examples])
}

export function mapAuthoringCapabilities() {
  return {
    workflowId: MAP_AUTHORING_WORKFLOW, examples: Object.keys(examples),
    commands: {
      example: 'node tools/harness/sceneweave.mjs map example landscape',
      referenceExample: 'node tools/harness/sceneweave.mjs map example landscape-reference',
      reference: 'node tools/harness/sceneweave.mjs map reference --image ABS_IMAGE --input ABS_GUIDE_JSON --output NEW_ABS_DIR --allow map-authoring',
      referenceDraft: 'node tools/harness/sceneweave.mjs map reference --image ABS_IMAGE --input ABS_GUIDE_JSON --output NEW_ABS_DIR --allow map-authoring --stage draft',
      diagnose: 'node tools/harness/sceneweave.mjs map diagnose --input ABS_JSON --allow map-authoring',
      diagnoseAndSave: 'node tools/harness/sceneweave.mjs map diagnose --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring',
      generate: 'node tools/harness/sceneweave.mjs map generate --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring',
      draft: 'node tools/harness/sceneweave.mjs map generate --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring --stage draft',
      inspect: 'node tools/harness/sceneweave.mjs map inspect --project ABS_SCENEWEAVE --allow map-authoring',
      edit: 'node tools/harness/sceneweave.mjs map edit --project ABS_SCENEWEAVE --input ABS_JSON --output NEW_ABS_DIR --allow map-authoring',
      verify: 'node tools/harness/sceneweave.mjs map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring',
      verifyEditor: 'node tools/harness/sceneweave.mjs map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring --editor reopen',
    },
    schemas: { reference: z.toJSONSchema(mapReferenceSchema, { io: 'input' }), generate: z.toJSONSchema(mapGenerateSchema, { io: 'input' }), edit: z.toJSONSchema(mapEditSchema, { io: 'input' }),
      inspect: z.toJSONSchema(mapInspectSchema, { io: 'input' }) },
    referenceGuide: { background: [{ x: 42, y: 40 }], design: {
      landforms: [{ id: 'summit', shape: 'plateau', at: { x: 552, y: 260 }, elevationMm: 6800 }],
      ascents: [{ id: 'ascent', from: { x: 355, y: 373 }, to: 'summit', around: 'north', widthMm: 1500 }],
    } } satisfies z.input<typeof mapReferenceSchema>,
    coordinates: 'landscape 配方有 referenceSizePx 时使用原图像素等比置于画布中央（可用 referenceScale 标定），否则配方位置和半径是横纵各 0–1000 的相对坐标。操作与通路检查默认使用整数毫米，有 referenceSizePx 时使用像素。净宽、高程和偏移均用毫米。',
    materials: 'coast / forest 素材库提供 water、shallow、rock、rock-wet、grass、sand、sand-wet；也可按工程中的固定材质 ID 选择。',
    delivery: { project: 'map.sceneweave', top: 'paths.preview', oblique: 'paths.oblique (on request or visible terrain height differences)', result: 'result.json',
      diagnostic: 'paths.diagnostic (locatable findings)', verify: '默认复用已有产物，仅保存回执；--delivery copy 生成独立交付。storage 报告各类字节。',
      draft: '已保存工程和真实预览，可局部编辑；满意后用 verify 核对同一份文件。', complete: '独立浏览器重新导入，实际通行与所有交付视图通过。' },
    scope: '从原图和背景取样点提取可编辑轮廓，在叠图上复核。用少量地貌和通行意图出首图。ascent 从低处区域接至高处地标，around 指定绕行方向。室内可直接给房间用途和关系。编辑作用于精确工程副本的指定楼层。',
  }
}
