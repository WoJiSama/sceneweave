import { z } from 'zod'
import { createCompositionContent } from '../appearance/graph.js'
import { polygonInside } from '../geometry/geometry.js'
import { LAYER_ENTITY_COLLECTIONS, type SceneDocument } from '../model/scene.js'
import { sha256Text } from '../validation/hash.js'
import { canonicalJson, captureJson, encodeUtf8, freezeJson } from '../validation/json.js'
import { nativeSceneSchema, sceneDocumentSchema } from '../validation/scene.js'
import { validateSceneSnapshot } from '../validation/snapshots.js'
import { assertSimpleVisualPolyline, signedVisualArea } from '../visual/geometry.js'
import { emptyVisualSystem } from '../visual/types.js'
import { composeTerrainDocument } from './compose.js'
import { materializeTerrainComposition } from './composition-materialize.js'
import { compositionPreset, compositionPresetSchema } from './composition-presets.js'
import { TERRAIN_COMPOSITION_LIMITS, terrainCompositionSourceSchema, terrainCompositionThresholdSchema,
  type TerrainCompositionPlan } from './composition-field.js'
import { terrainCommandCost } from './cost.js'
import { generateTerrainDocument, terrainGenerationInputSchema, terrainGenerationResultSchema } from './generate.js'

/** Domain envelopes contain editable geometry, never project resources or history. */
export const BASE_MAP_LIMITS = Object.freeze({ requestBytes: 4 * 1024 * 1024, resultBytes: 8 * 1024 * 1024, operations: 256 })
const protocol = { protocol: z.literal('sceneweave-base-map'), version: z.literal(1) }
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const generationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terrain'), input: terrainGenerationInputSchema }).strict(),
  z.object({ kind: z.literal('composition'), input: compositionPresetSchema }).strict(),
])
const algorithmSchema = z.object({ id: z.enum(['terrain-scene', 'terrain-scene-t3', 'terrain-compose']),
  version: z.union([z.literal(1), z.literal(2)]), recipeVersion: z.union([z.literal(1), z.literal(2)]) }).strict()
const context = { requestId: id, workspaceSceneId: id, checkpoint: integer, operationEpoch: integer }
const stamp = { ...context, inputHash: hash, baseHash: hash, paletteHash: hash, algorithm: algorithmSchema }
const preparationSchema = z.object({ ...context, base: sceneDocumentSchema, generation: generationSchema }).strict()
const requestSchema = z.object({ ...protocol, type: z.literal('generate'), ...stamp,
  base: sceneDocumentSchema, generation: generationSchema }).strict()
export type BaseMapRequest = z.infer<typeof requestSchema>

const coordinate = z.number().int().min(-1_000_000_000).max(1_000_000_000)
const point = z.object({ x: coordinate, y: coordinate }).strict()
const ppm = integer.max(1_000_000)
const signedPpm = z.number().int().min(-1_000_000).max(1_000_000)
const gridSchema = terrainCompositionThresholdSchema.shape.grid
const thresholdsSchema = z.object({ land: terrainCompositionThresholdSchema.optional(),
  elevation: terrainCompositionThresholdSchema.optional() }).strict()
const compositionInputSchema = terrainCompositionSourceSchema.omit({ algorithmId: true, algorithmVersion: true })
  .extend({ landCoveragePpm: ppm, elevationCoveragePpm: ppm, frozenThresholds: thresholdsSchema.optional() }).strict()
const ringSchema = z.array(point).min(3).max(TERRAIN_COMPOSITION_LIMITS.ringPoints)
const fieldPlanSchema = z.object({
  polygons: z.array(z.object({ outer: ringSchema, holes: z.array(ringSchema).max(TERRAIN_COMPOSITION_LIMITS.polygons) }).strict()).max(TERRAIN_COMPOSITION_LIMITS.polygons),
  contours: z.array(z.object({ pointsMm: ringSchema, hole: z.boolean(), polygonIndex: integer.max(TERRAIN_COMPOSITION_LIMITS.polygons - 1) }).strict()).max(TERRAIN_COMPOSITION_LIMITS.outputPoints / 3),
  thresholdQ: signedPpm, sampledCoveragePpm: ppm, targetCoveragePpm: ppm.nullable(), coverageErrorPpm: signedPpm.nullable(),
  areaMm2: z.number().finite().nonnegative(), vertexCount: integer.max(TERRAIN_COMPOSITION_LIMITS.outputPoints),
}).strict()
/** A complete strict parser, including the plan's formerly type-only nested fields. */
const compositionPlanSchema: z.ZodType<TerrainCompositionPlan> = z.object({
  algorithmId: z.literal('terrain-compose'), algorithmVersion: z.literal(1), input: compositionInputSchema, grid: gridSchema,
  fields: z.object({ land: fieldPlanSchema, elevation: fieldPlanSchema, vegetation: fieldPlanSchema }).strict(),
  thresholds: thresholdsSchema,
  geometryBudget: z.object({ gridNodes: integer.max(TERRAIN_COMPOSITION_LIMITS.gridNodes),
    polygons: integer.max(TERRAIN_COMPOSITION_LIMITS.polygons), rings: integer.max(TERRAIN_COMPOSITION_LIMITS.outputPoints / 3),
    points: integer.max(TERRAIN_COMPOSITION_LIMITS.outputPoints), finalAdoptionCostChecked: z.literal(false) }).strict(),
}).strict()
const costSchema = z.object({ items: z.record(id, integer.max(BASE_MAP_LIMITS.operations)),
  total: integer.max(BASE_MAP_LIMITS.operations), limit: z.literal(256), finalAdoptionCostChecked: z.literal(false) }).strict()
function terrainMapOrder(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const value = raw as Record<string, unknown>
  if (!value.document || typeof value.document !== 'object' || Array.isArray(value.document) || !Array.isArray(value.managedTargets)) return raw
  const document = value.document as Record<string, unknown>, visual = document.visual as Record<string, unknown> | undefined
  // The legacy result validator checks its managed-target array against map
  // insertion order. JSON maps are unordered: restore that order before the
  // unchanged strict validator runs. This changes no canonical value or hash.
  const order = (container: Record<string, unknown> | undefined, key: string, kind: string) => {
    const rows = container?.[key]
    if (!container || !rows || typeof rows !== 'object' || Array.isArray(rows)) return
    const entries = Object.entries(rows), priority = value.managedTargets as unknown[]
    const ids = priority.flatMap(target => target && typeof target === 'object' && 'kind' in target && target.kind === kind && 'id' in target && typeof target.id === 'string' ? [target.id] : [])
    container[key] = Object.fromEntries(entries.sort(([a], [b]) => {
      const ai = ids.indexOf(a), bi = ids.indexOf(b)
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
    }))
  }
  for (const [key, kind] of [['terrainAreas', 'terrainArea'], ['terrainConnections', 'terrainConnection'], ['paths', 'path'], ['props', 'prop']]) order(document, key, kind)
  order(visual, 'boundaries', 'visualBoundary'); order(visual, 'edgeLooks', 'visualEdgeLook')
  return value
}
const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('terrain'), terrain: z.preprocess(terrainMapOrder, terrainGenerationResultSchema) }).strict(),
  z.object({ kind: z.literal('composition'), document: nativeSceneSchema, plan: compositionPlanSchema }).strict(),
])
const responseSchema = z.object({ ...protocol, type: z.literal('result'), ...stamp,
  generation: generationSchema, resultHash: hash, result: resultSchema, domainCost: costSchema }).strict()
export type BaseMapResponse = z.infer<typeof responseSchema>
export type BaseMapDomainCost = BaseMapResponse['domainCost']

const equal = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
const digest = (value: unknown): string => sha256Text(canonicalJson(value))
function boundedCapture(raw: unknown, limit: number): unknown {
  const owned = captureJson(raw)
  if (encodeUtf8(canonicalJson(owned)).length > limit) throw new Error('程序底图协议超过字节预算。')
  return owned
}
function assertCanonical(raw: unknown, parsed: unknown): void {
  if (!equal(raw, parsed)) throw new Error('程序底图协议输入必须已经规范化；不能在传输或回放时补写默认值。')
}
function palette(document: SceneDocument): unknown {
  return { assets: document.assets, materials: document.materials, propDefinitions: document.propDefinitions,
    prefabDefinitions: document.prefabDefinitions, styleThemes: document.styleThemes, activeStyleThemeRef: document.activeStyleThemeRef }
}
function algorithmFor(generation: BaseMapRequest['generation']): BaseMapRequest['algorithm'] {
  if (generation.kind === 'composition') {
    const preset = compositionPreset(generation.input)
    return { id: 'terrain-compose', version: 1, recipeVersion: preset.request.recipeVersion ?? 1 }
  }
  const version = generation.input.algorithmVersion ?? 1
  return { id: generation.input.kind === 'island' || generation.input.kind === 'coast' ? 'terrain-scene' : 'terrain-scene-t3', version, recipeVersion: version }
}
function assertBlank(base: SceneDocument, generation: BaseMapRequest['generation']): void {
  const checked = validateSceneSnapshot(base)
  if (!checked.ok) throw new Error('程序底图基线不是有效完整场景。')
  const input = generation.input, bounds = { x: 0, y: 0, width: input.widthMm, height: input.heightMm }
  if (base.schemaVersion !== 2 || base.visual?.version !== 1 || base.sceneId !== input.sceneId
    || base.revision !== 0 || base.generationMetadata !== undefined
    || LAYER_ENTITY_COLLECTIONS.some(key => Object.keys(base[key]).length) || Object.keys(base.entityLayers).length
    || Object.keys(base.floors).length !== 1 || !base.floors['visual-floor'] || !equal(base.floors['visual-floor'].boundsMm, bounds)
    || !equal(base.exportBoundsMm, bounds) || !equal(base.visual, emptyVisualSystem())
    || base.constraints.entranceOpeningIds.length || base.constraints.pathChecks.length
    || Object.values(base.userLayers).some(layer => layer.editLocked)) throw new Error('程序底图只接受同范围、无实体、视觉、锁与历史记录的独立完整v2空白。')
  for (const layerId of ['visual-layer-ground', 'visual-layer-props', 'visual-layer-details']) {
    if (base.userLayers[layerId]?.floorId !== 'visual-floor') throw new Error('程序底图所需固定图层缺失。')
  }
}
function requestStamp(request: BaseMapRequest) {
  return { requestId: request.requestId, workspaceSceneId: request.workspaceSceneId, checkpoint: request.checkpoint,
    operationEpoch: request.operationEpoch, inputHash: request.inputHash, baseHash: request.baseHash,
    paletteHash: request.paletteHash, algorithm: request.algorithm }
}
function parseRequest(raw: unknown): BaseMapRequest {
  const owned = boundedCapture(raw, BASE_MAP_LIMITS.requestBytes), request = requestSchema.parse(owned)
  assertCanonical(owned, request)
  assertBlank(request.base, request.generation)
  if (!equal(request.algorithm, algorithmFor(request.generation)) || request.inputHash !== digest(request.generation)
    || request.baseHash !== digest(request.base) || request.paletteHash !== digest(palette(request.base))) throw new Error('程序底图请求的输入、素材或算法指纹不一致。')
  return freezeJson(request)
}

/** Normalize a fresh request once. Omitted legacy version selectors stay omitted. */
export function prepareBaseMapRequest(raw: unknown): BaseMapRequest {
  const input = preparationSchema.parse(boundedCapture(raw, BASE_MAP_LIMITS.requestBytes))
  assertBlank(input.base, input.generation)
  const request = { ...input, protocol: 'sceneweave-base-map', version: 1, type: 'generate',
    inputHash: digest(input.generation), baseHash: digest(input.base), paletteHash: digest(palette(input.base)), algorithm: algorithmFor(input.generation) }
  return parseRequest(request)
}

function countContext(prefix: string, now: string) {
  let serial = 0
  return { ids: { nextId: () => `${prefix}-${++serial}` }, clock: { now: () => now } }
}
function domainCost(request: BaseMapRequest, result: BaseMapResponse['result']): BaseMapDomainCost {
  let cost: ReturnType<typeof terrainCommandCost>
  if (result.kind === 'terrain') {
    cost = composeTerrainDocument(request.base, result.terrain, `base-map-birth-${request.inputHash}`).cost
  } else {
    // These complete graphs are count-only metadata. No fabricated history is
    // returned or installed; the application recounts after real preparation.
    const before = createCompositionContent(request.base, countContext('base-map-count-before', request.base.updatedAt))
    const after = createCompositionContent(result.document, countContext('base-map-count-after', request.base.updatedAt))
    cost = terrainCommandCost(before.document, after.document, { before, after })
  }
  return costSchema.parse({ ...cost, finalAdoptionCostChecked: false })
}
function resultHash(generation: BaseMapResponse['generation'], result: BaseMapResponse['result'], cost: BaseMapDomainCost): string {
  return digest({ generation, result, domainCost: cost })
}

function assertPlan(plan: TerrainCompositionPlan, request: BaseMapRequest): void {
  if (request.generation.kind !== 'composition') throw new Error('组合结果与请求种类不一致。')
  const expected = compositionPreset(request.generation.input).input
  if (!equal(plan.input, expected)) throw new Error('组合计划与规范化配方输入不同。')
  const source = { algorithmId: 'terrain-compose', algorithmVersion: 1, seed: expected.seed, precision: expected.precision,
    boundsMm: expected.boundsMm, baseElevationMm: expected.baseElevationMm, members: expected.members, features: expected.features }
  const b = plan.input.boundsMm, spacingMm = plan.input.precision.sampleSpacingMm
  if (!equal(plan.grid, { originMm: { x: b.x, y: b.y }, columns: Math.ceil(b.width / spacingMm) + 1,
    rows: Math.ceil(b.height / spacingMm) + 1, spacingMm })) throw new Error('组合格网回执与输入精度不同。')
  let polygons = 0, rings = 0, points = 0
  for (const field of ['land', 'elevation', 'vegetation'] as const) {
    const value = plan.fields[field], contours = value.polygons.flatMap((polygon, polygonIndex) => [
      { pointsMm: polygon.outer, hole: false, polygonIndex }, ...polygon.holes.map(hole => ({ pointsMm: hole, hole: true, polygonIndex })),
    ])
    if (!equal(value.contours, contours)) throw new Error('组合轮廓回执与完整多边形不同。')
    let area = 0, vertices = 0
    for (const polygon of value.polygons) {
      for (const [index, ring] of [polygon.outer, ...polygon.holes].entries()) {
        assertSimpleVisualPolyline(ring, true)
        if (ring.some(p => p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height)) throw new Error('组合轮廓超出输入范围。')
        const signed = signedVisualArea(ring)
        if (index === 0 ? signed <= 0 : signed >= 0 || !polygonInside(ring, polygon.outer)) throw new Error('组合轮廓方向或孔洞支撑无效。')
        area += signed; vertices += ring.length; rings++
      }
    }
    if (value.vertexCount !== vertices || value.areaMm2 !== area
      || (value.targetCoveragePpm === null ? value.coverageErrorPpm !== null : value.coverageErrorPpm !== value.sampledCoveragePpm - value.targetCoveragePpm)) throw new Error('组合面积、顶点或覆盖回执不一致。')
    polygons += value.polygons.length; points += vertices
    if (field === 'vegetation') {
      if (value.targetCoveragePpm !== null || value.thresholdQ !== 0) throw new Error('植被场不接受目标阈值回执。')
    } else {
      const threshold = plan.thresholds[field], active = expected.members.some(member => member.field === field)
      const target = field === 'land' ? expected.landCoveragePpm : expected.elevationCoveragePpm
      if (!!threshold !== active || value.targetCoveragePpm !== target || threshold && (threshold.field !== field
        || threshold.valueQ !== value.thresholdQ || threshold.targetCoveragePpm !== target
        || !equal(threshold.grid, plan.grid) || !equal(threshold.sourceInput, source))) throw new Error('组合冻结阈值与场回执不同。')
    }
  }
  if (!equal(plan.geometryBudget, { gridNodes: plan.grid.columns * plan.grid.rows, polygons, rings, points, finalAdoptionCostChecked: false })) throw new Error('组合几何预算回执与实际展开不同。')
}
function assertResultContext(request: BaseMapRequest, result: BaseMapResponse['result']): void {
  if (request.generation.kind !== result.kind) throw new Error('程序底图结果种类与请求不同。')
  const document: SceneDocument = result.kind === 'terrain' ? result.terrain.document : result.document
  const checked = validateSceneSnapshot(document)
  if (!checked.ok) throw new Error('程序底图结果未通过完整场景几何校验。')
  if (document.sceneId !== request.base.sceneId || document.revision !== request.base.revision
    || document.createdAt !== request.base.createdAt || document.updatedAt !== request.base.updatedAt
    || !equal(document.exportBoundsMm, request.base.exportBoundsMm) || !equal(document.floors, request.base.floors)
    || !equal(document.userLayers, request.base.userLayers) || !equal(document.units, request.base.units)
    || !equal(document.presetSnapshot, request.base.presetSnapshot) || !equal(document.constraints, request.base.constraints)
    || digest(palette(document)) !== request.paletteHash) throw new Error('程序底图结果改变独立身份、范围、图层或固定素材。')
  if (document.generationMetadata !== undefined || document.constraints.pathChecks.length || document.constraints.entranceOpeningIds.length
    || Object.keys(document.notes).length || Object.values(document.userLayers).some(layer => layer.editLocked)) throw new Error('程序底图结果含协议之外的历史、注记或锁。')
  for (const key of LAYER_ENTITY_COLLECTIONS) for (const entity of Object.values(document[key])) {
    if (entity.editLocked || 'visibility' in entity && entity.visibility !== 'public') throw new Error('程序底图结果含锁定或私密实体。')
  }
  const assertPublic = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'visibility' && child !== 'public' || key === 'editLocked' && child === true || key === 'secret' && child === true) throw new Error('程序底图结果不能夹带私密或锁定的派生记录。')
      assertPublic(child)
    }
  }
  assertPublic(document.visual); assertPublic(document.generation)
  if (result.kind === 'terrain') {
    if (!equal(result.terrain.input, request.generation.input)) throw new Error('地形结果不属于请求的规范化输入。')
  } else {
    if (document.schemaVersion !== 4 || document.generation?.version !== 5 || document.visual?.version !== 3) throw new Error('组合结果必须保全完整领域版本。')
    if (LAYER_ENTITY_COLLECTIONS.some(key => key !== 'terrainAreas' && Object.keys(document[key]).length)) throw new Error('组合底图含配方范围外实体。')
    assertPlan(result.plan, request)
  }
}

/** Pure execution shared by remote services and the browser's offline Worker. */
export function executeBaseMapRequest(raw: unknown): BaseMapResponse {
  const request = parseRequest(raw)
  let domainResult: unknown
  if (request.generation.kind === 'terrain') domainResult = { kind: 'terrain', terrain: generateTerrainDocument(request.base, request.generation.input) }
  else {
    const preset = compositionPreset(request.generation.input), recipeVersion = preset.request.recipeVersion ?? 1
    const profile = preset.request.preset === 'tidalCoast' ? recipeVersion === 2 ? 'tidal-v2' : 'tidal' : 'plain'
    domainResult = { kind: 'composition', ...materializeTerrainComposition(request.base, preset.input, preset.requirements, preset.name, profile, recipeVersion) }
  }
  const result = resultSchema.parse(domainResult)
  const cost = domainCost(request, result)
  return parseBaseMapResponse(request, { ...protocolValues(), type: 'result', ...requestStamp(request),
    generation: request.generation, result, domainCost: cost, resultHash: resultHash(request.generation, result, cost) })
}
const protocolValues = () => ({ protocol: 'sceneweave-base-map' as const, version: 1 as const })

/** Structural verification is not deterministic replay or final adoption proof. */
export function parseBaseMapResponse(requestInput: BaseMapRequest, raw: unknown): BaseMapResponse {
  const request = parseRequest(requestInput), owned = boundedCapture(raw, BASE_MAP_LIMITS.resultBytes), response = responseSchema.parse(owned)
  assertCanonical(owned, response)
  if (!equal(requestStamp(request), { requestId: response.requestId, workspaceSceneId: response.workspaceSceneId,
    checkpoint: response.checkpoint, operationEpoch: response.operationEpoch, inputHash: response.inputHash,
    baseHash: response.baseHash, paletteHash: response.paletteHash, algorithm: response.algorithm })
    || !equal(response.generation, request.generation)) throw new Error('程序底图结果的请求上下文已过期或不匹配。')
  if (response.resultHash !== resultHash(response.generation, response.result, response.domainCost)) throw new Error('程序底图结果指纹不同。')
  assertResultContext(request, response.result)
  if (!equal(response.domainCost, domainCost(request, response.result))) throw new Error('程序底图领域成本回执与实际完整展开不同。')
  return freezeJson(response)
}
