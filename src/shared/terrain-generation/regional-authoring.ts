import { z } from 'zod'
import type { BoundsMm, PointMm, SceneDocument } from '../model/scene.js'
import { cloneJson, canonicalJson } from '../validation/json.js'
import { validateSceneDocument } from '../validation/scene.js'
import { emptyTerrainDocument } from './compose.js'
import { assertTerrainBudget, terrainCommandCost } from './cost.js'
import { createEmptyGeneration, createEmptyRegional, type RegionalModel1, type GenerationReference, type SourceRegionFeature, type SourceRegionLink } from './contracts.js'
import { generationInputHash, managedOutputHash, regionalEntityVisibility, detachChangedOutputs } from './integrity.js'
import { polygonBoolean } from '../geometry/polygon-boolean.js'
import { inspectDependencies } from '../geometry/dependencies.js'
import { sha256Text } from '../geometry/scatter.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const integer = z.number().int().safe()
const point = z.object({ x: integer, y: integer }).strict()
const ring = z.array(point).min(3).max(512)
const bounds = z.object({ x: integer, y: integer, width: integer.positive(), height: integer.positive() }).strict()
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const style = z.object({ fill: color, stroke: color, strokeWidthMm: integer.nonnegative(), opacity: z.number().finite().min(0).max(1) }).strict()
const kindArea = z.enum(['land', 'water', 'forest', 'hill'])
const kindLine = z.enum(['river', 'ridge', 'road'])
const visibility = z.enum(['public', 'gm'])
const common = { id, floorId: id.optional(), layerId: id.optional(), visibility: visibility.default('public'), editLocked: z.boolean().default(false) }

const areaInput = z.object({ ...common, boundaryMm: ring, kind: kindArea, style: style.optional(), relativeElevationMm: integer.nullable().optional() }).strict()
const linePoint = z.object({ id, positionMm: point }).strict()
const versionRef = z.object({ id, version: integer.positive() }).strict()
const lineInput = z.object({ ...common, pointsMm: z.array(linePoint).min(2).max(512), kind: kindLine,
  displayWidthMm: integer.positive(), actualWidthMm: integer.positive().nullable().optional(), portIds: z.array(id).max(32).optional(),
  connectedLineIds: z.array(id).max(128).optional(), flow: z.enum(['forward', 'reverse', 'none']).optional(), style: style.optional() }).strict()
const landmarkInput = z.object({ ...common, positionMm: point, purpose: z.enum(['settlement', 'ruin', 'camp', 'natural', 'other']), name: z.string().min(1).max(120), description: z.string().max(2000), definitionRef: versionRef, areaId: id.nullable().optional() }).strict()
const symbolInput = z.object({ ...common, definitionRef: versionRef, positionMm: point, visualBoundsMm: bounds, renderOrder: integer, managementKey: id.nullable().optional(), sourceRef: z.object({ kind: z.enum(['area', 'line', 'landmark']), id }).strict().nullable().optional() }).strict()
const authoringOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('area'), id, floorId: id, layerId: id, boundaryMm: ring, areaKind: kindArea, visibility: visibility.optional(), editLocked: z.boolean().optional(), style: style.optional(), relativeElevationMm: integer.nullable().optional() }).strict(),
  z.object({ kind: z.literal('line'), id, floorId: id, layerId: id, pointsMm: z.array(point).min(2).max(512), lineKind: kindLine, displayWidthMm: integer.positive(), actualWidthMm: integer.positive().nullable(), visibility: visibility.optional(), editLocked: z.boolean().optional(), style: style.optional(), portIds: z.array(id).max(32).optional(), connectedLineIds: z.array(id).max(128).optional(), flow: z.enum(['forward', 'reverse', 'none']).optional() }).strict(),
  z.object({ kind: z.literal('landmark'), id, floorId: id, layerId: id, positionMm: point, purpose: z.enum(['settlement', 'ruin', 'camp', 'natural', 'other']), name: z.string().min(1).max(120), description: z.string().max(2000), definitionRef: versionRef, areaId: id.nullable().optional(), visibility: visibility.optional(), editLocked: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('symbol'), id, floorId: id, layerId: id, definitionRef: versionRef, positionMm: point, visualBoundsMm: bounds, renderOrder: integer, managementKey: id.nullable().optional(), sourceRef: z.object({ kind: z.enum(['area', 'line', 'landmark']), id }).strict().nullable().optional(), visibility: visibility.optional(), editLocked: z.boolean().optional() }).strict(),
])

/** A strict, renderer-independent T5 regional authoring request. Geometry is world mm. */
export const regionalAuthoringRequestSchema = z.object({
  kind: z.literal('regional'), sceneId: id, operationId: id, seed: z.string().min(1).max(128).default('regional-authoring-v1'),
  widthMm: integer.min(500_000).max(50_000_000).optional(), heightMm: integer.min(500_000).max(50_000_000).optional(),
  title: z.string().min(1).max(200).optional(), floorId: id.optional(), layerId: id.optional(),
  areas: z.array(areaInput).max(64).optional(), lines: z.array(lineInput).max(64).optional(),
  landmarks: z.array(landmarkInput).max(64).optional(), symbols: z.array(symbolInput).max(128).optional(),
  selectionMm: bounds.optional(), drillDown: z.null().optional(), operations: z.array(authoringOperation).max(256).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.widthMm !== undefined && value.heightMm !== undefined && (Math.max(value.widthMm, value.heightMm) > 50_000_000 || Math.min(value.widthMm, value.heightMm) < 500_000)) ctx.addIssue({ code: 'custom', message: '区域范围须为0.5–50km的整数毫米。' })
  if (value.widthMm === undefined && value.heightMm === undefined && !value.selectionMm) ctx.addIssue({ code: 'custom', message: '区域请求必须提供范围。' })
})
export type RegionalAuthoringRequest = z.infer<typeof regionalAuthoringRequestSchema>
export const regionalCreateRequestSchema = regionalAuthoringRequestSchema

const regionalEdit = z.object({
  kind: z.literal('regionalEdit'), sceneId: id, operationId: id,
  operation: z.enum(['upsertArea', 'upsertLine', 'upsertLandmark', 'upsertSymbol', 'deleteArea', 'deleteLine', 'deleteLandmark', 'deleteSymbol']),
  area: areaInput.optional(), line: lineInput.optional(), landmark: landmarkInput.optional(), symbol: symbolInput.optional(), entityId: id.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.operation === 'upsertArea' && !value.area) ctx.addIssue({ code: 'custom', path: ['area'], message: '新增/修改区域面必须提供area。' })
  if (value.operation === 'upsertLine' && !value.line) ctx.addIssue({ code: 'custom', path: ['line'], message: '新增/修改区域线必须提供line。' })
  if (value.operation === 'upsertLandmark' && !value.landmark) ctx.addIssue({ code: 'custom', path: ['landmark'], message: '新增/修改地标必须提供landmark。' })
  if (value.operation === 'upsertSymbol' && !value.symbol) ctx.addIssue({ code: 'custom', path: ['symbol'], message: '新增/修改图符必须提供symbol。' })
  if (value.operation.startsWith('delete') && !value.entityId) ctx.addIssue({ code: 'custom', path: ['entityId'], message: '删除必须明确实体ID。' })
})
export type RegionalEditRequest = z.infer<typeof regionalEdit>
export const regionalEditRequestSchema = regionalEdit

export const regionalDrillDownRequestSchema = z.object({
  kind: z.literal('regionalDrillDown'), sourceSceneId: id, sceneId: id, operationId: id,
  selectionMm: bounds, title: z.string().min(1).max(200).optional(), includePrivate: z.boolean().default(false),
}).strict()
export type RegionalDrillDownRequest = z.infer<typeof regionalDrillDownRequestSchema>

export interface RegionalAuthoringResult { request: RegionalAuthoringRequest; document: SceneDocument; cost: ReturnType<typeof terrainCommandCost>; hash: string }
export interface RegionalEditResult { request: RegionalEditRequest; document: SceneDocument; cost: ReturnType<typeof terrainCommandCost>; hash: string }
export interface RegionalDrillDownResult { request: RegionalDrillDownRequest; document: SceneDocument; sourceLink: SourceRegionLink; cost: ReturnType<typeof terrainCommandCost>; hash: string }

const p = (x: number, y: number): PointMm => ({ x, y })
const rectangle = (width: number, height: number): PointMm[] => [p(0, 0), p(width, 0), p(width, height), p(0, height)]
const defaultStyle = (kind: 'land' | 'water' | 'forest' | 'hill'): RegionalModel1['areas'][string]['style'] => ({
  fill: ({ land: '#B8BE86', water: '#86B2B7', forest: '#617C58', hill: '#9E9577' })[kind],
  stroke: ({ land: '#5D6B56', water: '#588D98', forest: '#4E6749', hill: '#80745B' })[kind], strokeWidthMm: 20_000, opacity: 1,
})
const lineStyle = (kind: 'river' | 'ridge' | 'road'): RegionalModel1['areas'][string]['style'] => ({
  fill: ({ river: '#86B2B7', ridge: '#9E9577', road: '#BAA27D' })[kind],
  stroke: ({ river: '#588D98', ridge: '#80745B', road: '#8E795C' })[kind], strokeWidthMm: ({ river: 50_000, ridge: 35_000, road: 25_000 })[kind], opacity: 1,
})
const allEntityIds = (scene: SceneDocument): Set<string> => {
  const ids = new Set<string>()
  const visit = (value: unknown) => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') { const row = value as Record<string, unknown>; if (typeof row.id === 'string') ids.add(row.id); Object.values(row).forEach(visit) } }
  visit(scene); return ids
}
const ensureRegionalBase = (base: SceneDocument): SceneDocument => {
  const checked = validateSceneDocument(base)
  if (!checked.ok) throw new Error(`区域工程基线无效：${checked.errors.map(error => error.message).join('；')}`)
  for (const key of ['vertices', 'rooms', 'walls', 'openings', 'props', 'regions', 'notes', 'terrainAreas', 'terrainEdges', 'terrainConnections', 'paths', 'prefabInstances', 'scatterGroups'] as const) {
    if (Object.keys(base[key]).length) throw new Error('区域地图不得携带人物场景实体。')
  }
  if (base.schemaVersion === 2 && base.visual?.version === 1) return emptyTerrainDocument(base)
  if (base.schemaVersion === 3 && base.mapMode === 'regional' && base.visual?.version === 2 && base.regional) return cloneJson(base)
  throw new Error('区域地图须从完整v2空白或既有完整v3区域工程开始。')
}
const resolveFloorLayer = (scene: SceneDocument, floorId?: string, layerId?: string) => {
  const resolvedFloor = floorId ?? Object.keys(scene.floors)[0]
  const resolvedLayer = layerId ?? Object.keys(scene.userLayers).find(key => scene.userLayers[key].floorId === resolvedFloor)
  if (!resolvedFloor || !scene.floors[resolvedFloor] || !resolvedLayer || !scene.userLayers[resolvedLayer]) throw new Error('区域地图缺少有效Floor或用户图层。')
  if (scene.userLayers[resolvedLayer].editLocked) throw new Error('区域地图所属图层已锁定。')
  return { floorId: resolvedFloor, layerId: resolvedLayer }
}
const within = (position: PointMm, area: BoundsMm) => position.x >= area.x && position.y >= area.y && position.x <= area.x + area.width && position.y <= area.y + area.height
const assertFeatureBounds = (scene: SceneDocument, points: PointMm[]) => { if (points.some(point => !within(point, scene.exportBoundsMm))) throw new Error('区域实体超出工程范围。') }
const addGeneratedFeatures = (scene: SceneDocument, request: RegionalAuthoringRequest, floorId: string, layerId: string) => {
  const regional = scene.regional!, width = request.widthMm ?? request.selectionMm?.width, height = request.heightMm ?? request.selectionMm?.height
  if (width === undefined || height === undefined) throw new Error('区域生成必须提供宽高。')
  const area = (id: string, kind: 'land' | 'water' | 'forest' | 'hill', boundaryMm: PointMm[], relativeElevationMm: number | null = 0) => {
    regional.areas[id] = { id, floorId, layerId, visibility: 'public', editLocked: false, boundaryMm, kind, style: defaultStyle(kind), relativeElevationMm }
  }
  if (!regional.areas[`regional-${request.operationId}-land`]) area(`regional-${request.operationId}-land`, 'land', rectangle(width, height))
  if (!regional.areas[`regional-${request.operationId}-forest`]) area(`regional-${request.operationId}-forest`, 'forest', [p(Math.round(width * .12), Math.round(height * .36)), p(Math.round(width * .34), Math.round(height * .27)), p(Math.round(width * .43), Math.round(height * .68)), p(Math.round(width * .2), Math.round(height * .78))], null)
  const line = (id: string, kind: 'river' | 'ridge' | 'road', pointsMm: PointMm[], displayWidthMm: number, actualWidthMm: number | null) => {
    regional.lines[id] = { id, floorId, layerId, visibility: 'public', editLocked: false, kind, pointsMm: pointsMm.map((positionMm, index) => ({ id: `${id}-point-${index}`, positionMm })), displayWidthMm, actualWidthMm, portIds: [], connectedLineIds: [], flow: kind === 'river' ? 'forward' : 'none', style: lineStyle(kind) }
  }
  line(`regional-${request.operationId}-river`, 'river', [p(Math.round(width * .58), height), p(Math.round(width * .62), Math.round(height * .72)), p(Math.round(width * .5), Math.round(height * .46)), p(Math.round(width * .55), Math.round(height * .2))], 70_000, 60_000)
  line(`regional-${request.operationId}-ridge`, 'ridge', [p(Math.round(width * .62), Math.round(height * .86)), p(Math.round(width * .72), Math.round(height * .62)), p(Math.round(width * .82), Math.round(height * .32))], 50_000, null)
}
const addRequestedFeatures = (scene: SceneDocument, request: RegionalAuthoringRequest, floorId: string, layerId: string) => {
  const regional = scene.regional!
  for (const input of request.areas ?? []) {
    if (regional.areas[input.id]) throw new Error(`区域面身份已存在：${input.id}。`)
    const id = input.id, boundaryMm = input.boundaryMm.map(point => ({ ...point })); assertFeatureBounds(scene, boundaryMm)
    regional.areas[id] = { id, floorId: input.floorId ?? floorId, layerId: input.layerId ?? layerId, visibility: input.visibility, editLocked: input.editLocked, boundaryMm, kind: input.kind, style: input.style ?? defaultStyle(input.kind), relativeElevationMm: input.relativeElevationMm ?? 0 }
  }
  for (const input of request.lines ?? []) {
    if (regional.lines[input.id]) throw new Error(`区域线身份已存在：${input.id}。`)
    const pointsMm = input.pointsMm.map(point => ({ id: point.id, positionMm: { ...point.positionMm } })); assertFeatureBounds(scene, pointsMm.map(point => point.positionMm))
    regional.lines[input.id] = { id: input.id, floorId: input.floorId ?? floorId, layerId: input.layerId ?? layerId, visibility: input.visibility, editLocked: input.editLocked, pointsMm,
      kind: input.kind, displayWidthMm: input.displayWidthMm, actualWidthMm: input.actualWidthMm ?? null, portIds: input.portIds ?? [], connectedLineIds: input.connectedLineIds ?? [], flow: input.flow ?? 'none', style: input.style ?? lineStyle(input.kind) }
  }
  for (const input of request.landmarks ?? []) {
    if (regional.landmarks[input.id]) throw new Error(`区域地标身份已存在：${input.id}。`)
    assertFeatureBounds(scene, [input.positionMm]); regional.landmarks[input.id] = { id: input.id, floorId: input.floorId ?? floorId, layerId: input.layerId ?? layerId, visibility: input.visibility, editLocked: input.editLocked,
      positionMm: { ...input.positionMm }, purpose: input.purpose, name: input.name, description: input.description, definitionRef: { ...input.definitionRef }, areaId: input.areaId ?? null }
  }
  for (const input of request.symbols ?? []) {
    if (regional.symbols[input.id]) throw new Error(`区域图符身份已存在：${input.id}。`)
    assertFeatureBounds(scene, [input.positionMm]); regional.symbols[input.id] = { id: input.id, floorId: input.floorId ?? floorId, layerId: input.layerId ?? layerId, visibility: input.visibility, editLocked: input.editLocked,
      definitionRef: { ...input.definitionRef }, positionMm: { ...input.positionMm }, visualBoundsMm: { ...input.visualBoundsMm }, orientation: 'upright', renderOrder: input.renderOrder, managementKey: input.managementKey ?? null, sourceRef: input.sourceRef ?? null }
  }
}
const outputRefs = (scene: SceneDocument): GenerationReference[] => {
  const regional = scene.regional!
  return [
    ...Object.keys(regional.areas).map(entityId => ({ kind: 'regionalArea' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.lines).map(entityId => ({ kind: 'regionalLine' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.landmarks).map(entityId => ({ kind: 'regionalLandmark' as const, entityId, parentId: null, fieldGroup: 'geometry' as const })),
    ...Object.keys(regional.symbols).map(entityId => ({ kind: 'regionalSymbol' as const, entityId, parentId: null, fieldGroup: 'appearance' as const })),
  ]
}
const refreshRegionalOutputs = (scene: SceneDocument, before: SceneDocument, birthToken: string) => {
  detachChangedOutputs(before, scene)
  const generation = scene.generation!, rule = Object.values(generation.rules).find(rule => rule.kind === 'regional')
  if (!rule) return
  const existing = new Set(Object.values(generation.ownership).map(owner => canonicalJson(owner.target)))
  for (const ref of outputRefs(scene)) {
    if (existing.has(canonicalJson(ref))) continue
    if (rule.editLocked || scene.userLayers[rule.layerId]?.editLocked) throw new Error('区域规则或图层已锁定。')
    rule.outputs.push({ ...ref })
    const ownerId = `regional-owner-${ref.kind}-${ref.entityId}`
    if (generation.ownership[ownerId]) throw new Error(`区域输出身份已存在：${ownerId}。`)
    generation.ownership[ownerId] = { id: ownerId, outputKey: `${birthToken}/${ref.kind}/${ref.entityId}`, ruleId: rule.id, target: { ...ref },
      managedFields: [], manualFields: ref.kind === 'regionalSymbol' ? ['geometry', 'appearance', 'source'] : ['geometry', 'properties', 'surface'], state: 'manual', birthToken }
  }
  rule.inputHash = generationInputHash(scene, rule); rule.managedOutputHash = managedOutputHash(scene, rule)
}
const installGeneration = (scene: SceneDocument, request: RegionalAuthoringRequest, floorId: string, layerId: string) => {
  const generation = scene.generation = createEmptyGeneration(), recipeId = `regional-recipe-${request.operationId}`, intentId = `regional-intent-${request.operationId}`, ruleId = `regional-rule-${request.operationId}`
  generation.recipes[recipeId] = { id: recipeId, recipeVersion: 1, algorithmId: 'regional-authoring-v1', algorithmVersion: 1, mapMode: 'regional', seed: request.seed,
    parameters: { terrainKind: 'mixed', seaElevationMm: 0, landElevationMm: 0, plateauElevationMm: 0, roughness: .15, densityFactor: .25, baySide: 'north' }, materials: [], props: [], precision: { sampleSpacingMm: 100_000, toleranceMm: 10_000, noiseCellMm: 100_000 } }
  generation.intents[intentId] = { id: intentId, floorId, visibility: 'public', boundsMm: cloneJson(scene.exportBoundsMm), skeleton: [], constraintIds: [], preserveIds: [] }
  generation.rules[ruleId] = { id: ruleId, floorId, layerId, visibility: 'public', editLocked: false, kind: 'regional', recipeRef: { id: recipeId, version: 1 }, inputs: [], outputs: outputRefs(scene), parameters: { widthMm: scene.exportBoundsMm.width, minWidthMm: 0, maxWidthMm: scene.exportBoundsMm.width, roughness: .15, densityFactor: .25 }, state: 'active', inputHash: '0'.repeat(64), managedOutputHash: '0'.repeat(64) }
  for (const [index, target] of generation.rules[ruleId].outputs.entries()) generation.ownership[`regional-owner-${index}`] = { id: `regional-owner-${index}`, outputKey: `${request.operationId}/${target.kind}/${target.entityId}`, ruleId, target, managedFields: target.kind === 'regionalSymbol' ? ['appearance'] : ['geometry', 'properties', 'surface'], manualFields: [], state: 'managed', birthToken: `${request.operationId}-birth` }
  generation.rules[ruleId].inputHash = generationInputHash(scene, generation.rules[ruleId]); generation.rules[ruleId].managedOutputHash = managedOutputHash(scene, generation.rules[ruleId])
}

/** Creates a complete, standalone regional document from an empty v2 or regional v3 base. */
export function createRegionalDocument(base: SceneDocument, rawInput: unknown): RegionalAuthoringResult {
  const request = regionalAuthoringRequestSchema.parse(rawInput), scene = ensureRegionalBase(base), { floorId, layerId } = resolveFloorLayer(scene, request.floorId, request.layerId)
  const width = request.widthMm ?? request.selectionMm?.width, height = request.heightMm ?? request.selectionMm?.height
  if (width === undefined || height === undefined) throw new Error('区域生成必须提供宽高。')
  const definitions = cloneJson(scene.regional?.symbolDefinitions ?? {})
  scene.sceneId = request.sceneId; scene.title = request.title ?? scene.title; scene.mapMode = 'regional'; scene.regional = createEmptyRegional(); scene.regional.symbolDefinitions = definitions; scene.exportBoundsMm = { x: 0, y: 0, width, height }
  scene.floors[floorId].boundsMm = cloneJson(scene.exportBoundsMm); addGeneratedFeatures(scene, request, floorId, layerId); addRequestedFeatures(scene, request, floorId, layerId); installGeneration(scene, request, floorId, layerId)
  const checked = validateSceneDocument(scene); if (!checked.ok) throw new Error(`区域候选无效：${checked.errors.map(error => `${error.code}:${error.message}`).join('；')}`)
  const empty = cloneJson(scene); empty.regional = createEmptyRegional(); empty.generation = createEmptyGeneration(); const cost = assertTerrainBudget(empty, checked.document)
  return { request, document: checked.document, cost, hash: sha256Text(canonicalJson({ request, document: checked.document, cost })) }
}

const assertEditableRegional = (scene: SceneDocument, id: string, row: { editLocked: boolean; layerId: string }) => {
  if (row.editLocked || scene.userLayers[row.layerId]?.editLocked) throw new Error(`区域实体或图层已锁定：${id}。`)
}
/** Applies one explicit regional edit. It never writes physical scene collections. */
export function prepareRegionalEdit(base: SceneDocument, rawInput: unknown): RegionalEditResult {
  const request = regionalEdit.parse(rawInput), checked = validateSceneDocument(base)
  if (!checked.ok || base.schemaVersion !== 3 || base.mapMode !== 'regional' || !base.regional) throw new Error('区域编辑需要完整v3区域地图。')
  if (request.sceneId !== base.sceneId) throw new Error('区域编辑工程身份已变化。')
  const scene = cloneJson(base), regional = scene.regional!, before = cloneJson(base)
  const inputRow = request.area ?? request.line ?? request.landmark ?? request.symbol
  if (inputRow) {
    const layerId = inputRow.layerId ?? Object.keys(scene.userLayers)[0]
    if (scene.userLayers[layerId]?.editLocked) throw new Error('区域目标图层已锁定。')
  }
  if (request.operation === 'upsertArea') {
    const input = request.area!, existing = regional.areas[input.id]; if (existing) assertEditableRegional(scene, input.id, existing); assertFeatureBounds(scene, input.boundaryMm)
    regional.areas[input.id] = { id: input.id, floorId: input.floorId ?? existing?.floorId ?? Object.keys(scene.floors)[0], layerId: input.layerId ?? existing?.layerId ?? Object.keys(scene.userLayers)[0], visibility: input.visibility, editLocked: input.editLocked, boundaryMm: cloneJson(input.boundaryMm), kind: input.kind, style: input.style ?? defaultStyle(input.kind), relativeElevationMm: input.relativeElevationMm ?? 0 }
  } else if (request.operation === 'upsertLine') {
    const input = request.line!, existing = regional.lines[input.id]; if (existing) assertEditableRegional(scene, input.id, existing); const pointsMm = cloneJson(input.pointsMm); assertFeatureBounds(scene, pointsMm.map(point => point.positionMm))
    regional.lines[input.id] = { id: input.id, floorId: input.floorId ?? existing?.floorId ?? Object.keys(scene.floors)[0], layerId: input.layerId ?? existing?.layerId ?? Object.keys(scene.userLayers)[0], visibility: input.visibility, editLocked: input.editLocked, pointsMm, kind: input.kind, displayWidthMm: input.displayWidthMm, actualWidthMm: input.actualWidthMm ?? null, portIds: input.portIds ?? [], connectedLineIds: input.connectedLineIds ?? [], flow: input.flow ?? 'none', style: input.style ?? lineStyle(input.kind) }
  } else if (request.operation === 'upsertLandmark') {
    const input = request.landmark!, existing = regional.landmarks[input.id]; if (existing) assertEditableRegional(scene, input.id, existing); assertFeatureBounds(scene, [input.positionMm])
    regional.landmarks[input.id] = { id: input.id, floorId: input.floorId ?? existing?.floorId ?? Object.keys(scene.floors)[0], layerId: input.layerId ?? existing?.layerId ?? Object.keys(scene.userLayers)[0], visibility: input.visibility, editLocked: input.editLocked,
      positionMm: { ...input.positionMm }, purpose: input.purpose, name: input.name, description: input.description, definitionRef: { ...input.definitionRef }, areaId: input.areaId ?? null }
  } else if (request.operation === 'upsertSymbol') {
    const input = request.symbol!, existing = regional.symbols[input.id]; if (existing) assertEditableRegional(scene, input.id, existing); assertFeatureBounds(scene, [input.positionMm])
    regional.symbols[input.id] = { id: input.id, floorId: input.floorId ?? existing?.floorId ?? Object.keys(scene.floors)[0], layerId: input.layerId ?? existing?.layerId ?? Object.keys(scene.userLayers)[0], visibility: input.visibility, editLocked: input.editLocked,
      definitionRef: { ...input.definitionRef }, positionMm: { ...input.positionMm }, visualBoundsMm: { ...input.visualBoundsMm }, orientation: 'upright', renderOrder: input.renderOrder, managementKey: input.managementKey ?? null, sourceRef: input.sourceRef ?? null }
  } else if (request.operation === 'deleteArea') {
    const existing = regional.areas[request.entityId!]; if (!existing) throw new Error(`区域面不存在：${request.entityId}。`); assertEditableRegional(scene, request.entityId!, existing); delete regional.areas[request.entityId!]
  } else if (request.operation === 'deleteLine') {
    const existing = regional.lines[request.entityId!]; if (!existing) throw new Error(`区域线不存在：${request.entityId}。`); assertEditableRegional(scene, request.entityId!, existing); delete regional.lines[request.entityId!]
  } else if (request.operation === 'deleteLandmark') {
    const existing = regional.landmarks[request.entityId!]; if (!existing) throw new Error(`区域地标不存在：${request.entityId}。`); assertEditableRegional(scene, request.entityId!, existing); delete regional.landmarks[request.entityId!]
  } else {
    const existing = regional.symbols[request.entityId!]; if (!existing) throw new Error(`区域图符不存在：${request.entityId}。`); assertEditableRegional(scene, request.entityId!, existing); delete regional.symbols[request.entityId!]
  }
  refreshRegionalOutputs(scene, before, `${request.operationId}-birth`)
  const result = validateSceneDocument(scene); if (!result.ok) throw new Error(`区域编辑候选无效：${result.errors.map(error => error.message).join('；')}`)
  const cost = assertTerrainBudget(before, result.document)
  return { request, document: result.document, cost, hash: sha256Text(canonicalJson({ request, document: result.document, cost })) }
}

const clipSegment = (a: PointMm, b: PointMm, box: BoundsMm): [PointMm, PointMm] | null => {
  let t0 = 0, t1 = 1, dx = b.x - a.x, dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]] as [number, number][]) {
    if (p === 0) { if (q < 0) return null; continue }
    const t = q / p; if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t } else { if (t < t0) return null; if (t < t1) t1 = t }
  }
  return [{ x: Math.round(a.x + dx * t0) - box.x, y: Math.round(a.y + dy * t0) - box.y }, { x: Math.round(a.x + dx * t1) - box.x, y: Math.round(a.y + dy * t1) - box.y }]
}
const publicFeatureSnapshot = (parent: SceneDocument, selection: BoundsMm, includePrivate: boolean) => {
  const regional = parent.regional!, inherited: SourceRegionFeature[] = []
  const visible = (kind: 'area' | 'line' | 'landmark' | 'symbol', id: string) => includePrivate || regionalEntityVisibility(parent, kind, id) === 'public'
  const clip = rectangle(selection.width, selection.height).map(point => ({ x: point.x + selection.x, y: point.y + selection.y }))
  const translate = (points: PointMm[]) => points.map(point => ({ x: point.x - selection.x, y: point.y - selection.y }))
  const definition = (ref: { id: string; version: number }, owner: string) => {
    const row = regional.symbolDefinitions[ref.id]
    if (!row || row.version !== ref.version) throw new Error(`区域来源图符定义缺失：${owner}。`)
    return cloneJson(row)
  }
  for (const area of Object.values(regional.areas)) if (visible('area', area.id)) {
    const clipped = polygonBoolean({ operation: 'intersection', subject: [area.boundaryMm], clip: [clip] })
    for (const [index, polygon] of clipped.polygons.entries()) {
      if (polygon.holes.length) throw new Error('区域下钻裁切产生未支持孔洞；请缩小选区。')
      inherited.push({ id: `${area.id}-source-${index}`, kind: 'area', sourceEntityId: area.id, visibility: regionalEntityVisibility(parent, 'area', area.id), pointsMm: translate(polygon.outer), terrainKind: area.kind, widthMm: 0, elevationMm: area.relativeElevationMm, precisionMm: regional.profile.simplificationErrorMm, estimated: false })
    }
  }
  for (const line of Object.values(regional.lines)) if (visible('line', line.id)) {
    // Preserve a fully enclosed polyline as one source feature so its turn
    // remains editable. Only split when the selection actually disconnects
    // the source into separate clipped segments.
    if (line.pointsMm.every(point => within(point.positionMm, selection))) {
      const points = line.flow === 'reverse' ? [...line.pointsMm].reverse() : line.pointsMm
      inherited.push({ id: `${line.id}-source`, kind: 'line', sourceEntityId: line.id, visibility: regionalEntityVisibility(parent, 'line', line.id),
        pointsMm: points.map(point => ({ x: point.positionMm.x - selection.x, y: point.positionMm.y - selection.y })), terrainKind: line.kind,
        widthMm: line.actualWidthMm ?? line.displayWidthMm, elevationMm: null, precisionMm: regional.profile.simplificationErrorMm,
        estimated: line.actualWidthMm === null })
      continue
    }
    // Separate every clipped segment. Rejoining disconnected pieces would invent a
    // route across the excluded region and lose the original segment direction.
    for (let i = 1; i < line.pointsMm.length; i++) {
      const segment = clipSegment(line.pointsMm[i - 1].positionMm, line.pointsMm[i].positionMm, selection)
      if (!segment || segment[0].x === segment[1].x && segment[0].y === segment[1].y) continue
      const pointsMm = line.flow === 'reverse' ? [...segment].reverse() : segment
      inherited.push({ id: `${line.id}-source-${i - 1}`, kind: 'line', sourceEntityId: line.id, visibility: regionalEntityVisibility(parent, 'line', line.id), pointsMm, terrainKind: line.kind, widthMm: line.actualWidthMm ?? line.displayWidthMm, elevationMm: null, precisionMm: regional.profile.simplificationErrorMm, estimated: line.actualWidthMm === null })
    }
  }
  for (const landmark of Object.values(regional.landmarks)) if (visible('landmark', landmark.id) && within(landmark.positionMm, selection)) inherited.push({
    id: `${landmark.id}-source`, kind: 'landmark', sourceEntityId: landmark.id, visibility: regionalEntityVisibility(parent, 'landmark', landmark.id),
    pointsMm: [{ x: landmark.positionMm.x - selection.x, y: landmark.positionMm.y - selection.y }], terrainKind: 'landmark', widthMm: 0, elevationMm: null,
    precisionMm: regional.profile.simplificationErrorMm, estimated: false, landmark: { positionMm: { x: landmark.positionMm.x - selection.x, y: landmark.positionMm.y - selection.y },
      purpose: landmark.purpose, name: landmark.name, description: landmark.description, definitionRef: cloneJson(landmark.definitionRef), areaId: landmark.areaId, definition: definition(landmark.definitionRef, landmark.id) },
  })
  for (const symbol of Object.values(regional.symbols)) if (visible('symbol', symbol.id) && within(symbol.positionMm, selection)) inherited.push({
    id: `${symbol.id}-source`, kind: 'symbol', sourceEntityId: symbol.id, visibility: regionalEntityVisibility(parent, 'symbol', symbol.id),
    pointsMm: [{ x: symbol.positionMm.x - selection.x, y: symbol.positionMm.y - selection.y }], terrainKind: 'symbol', widthMm: 0, elevationMm: null,
    precisionMm: regional.profile.simplificationErrorMm, estimated: false, symbol: { definitionRef: cloneJson(symbol.definitionRef), definition: definition(symbol.definitionRef, symbol.id),
      positionMm: { x: symbol.positionMm.x - selection.x, y: symbol.positionMm.y - selection.y }, visualBoundsMm: cloneJson(symbol.visualBoundsMm), orientation: symbol.orientation,
      renderOrder: symbol.renderOrder, managementKey: symbol.managementKey, sourceRef: cloneJson(symbol.sourceRef) },
  })
  for (const constraint of Object.values(parent.generation?.constraints ?? {})) if (constraint.kind === 'port' && (includePrivate || constraint.visibility === 'public') && within(constraint.positionMm, selection)) inherited.push({
    id: `${constraint.id}-source`, kind: 'port', sourceEntityId: constraint.id, visibility: constraint.visibility,
    pointsMm: [{ x: constraint.positionMm.x - selection.x, y: constraint.positionMm.y - selection.y }], terrainKind: 'port', widthMm: constraint.widthMm,
    elevationMm: null, precisionMm: regional.profile.simplificationErrorMm, estimated: false, directionDeg: constraint.directionDeg,
  })
  return inherited
}

/** Hashes only the explicitly inherited feature subset used by an AI regional candidate. */
export function regionalAuthorizedSubsetHash(parent: SceneDocument, link: Pick<SourceRegionLink, 'sourceSceneId' | 'sourceRevision' | 'selectionMm' | 'inherited'>): string {
  const referenceKey = (kind: SourceRegionFeature['kind'], id: string) => `${kind}\0${id}`
  const allowed = new Set(link.inherited.map(feature => referenceKey(feature.kind, feature.sourceEntityId)))
  // A copied relation can point to an authorized source outside the selection.
  // Preserve those explicit references, while keeping omitted relations outside
  // this snapshot's grant when rebuilding from the complete local parent.
  const allowedRelations = new Set(allowed)
  for (const feature of link.inherited) {
    if (feature.kind === 'landmark' && 'landmark' in feature && feature.landmark.areaId) allowedRelations.add(referenceKey('area', feature.landmark.areaId))
    if (feature.kind === 'symbol' && 'symbol' in feature && feature.symbol.sourceRef) allowedRelations.add(referenceKey(feature.symbol.sourceRef.kind, feature.symbol.sourceRef.id))
  }
  const inherited = publicFeatureSnapshot(parent, link.selectionMm, false)
    .filter(feature => allowed.has(referenceKey(feature.kind, feature.sourceEntityId)))
    .map(feature => {
      if (feature.kind === 'landmark' && 'landmark' in feature && feature.landmark.areaId
        && !allowedRelations.has(referenceKey('area', feature.landmark.areaId))) feature.landmark.areaId = null
      if (feature.kind === 'symbol' && 'symbol' in feature && feature.symbol.sourceRef
        && !allowedRelations.has(referenceKey(feature.symbol.sourceRef.kind, feature.symbol.sourceRef.id))) feature.symbol.sourceRef = null
      return feature
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  return sha256Text(canonicalJson({ sourceSceneId: link.sourceSceneId, sourceRevision: link.sourceRevision, selectionMm: link.selectionMm, inherited }))
}

/** Creates an independent scene candidate from an axis-aligned regional selection (at most 500m). */
export function prepareRegionalDrillDown(base: SceneDocument, rawInput: unknown): RegionalDrillDownResult {
  const request = regionalDrillDownRequestSchema.parse(rawInput), checked = validateSceneDocument(base)
  if (!checked.ok || base.schemaVersion !== 3 || base.mapMode !== 'regional' || !base.regional) throw new Error('区域下钻需要完整v3区域地图。')
  if (request.sourceSceneId !== base.sceneId) throw new Error('来源区域工程身份已变化。')
  const selection = request.selectionMm, sourceBounds = base.exportBoundsMm
  if (selection.width > 500_000 || selection.height > 500_000 || !within({ x: selection.x, y: selection.y }, sourceBounds) || !within({ x: selection.x + selection.width, y: selection.y + selection.height }, sourceBounds)) throw new Error('区域下钻选区必须是范围内不超过500m的轴对齐矩形。')
  const inherited = publicFeatureSnapshot(base, selection, request.includePrivate), publicPayload = inherited.filter(feature => feature.visibility === 'public'), scene = cloneJson(base)
  scene.sceneId = request.sceneId; scene.title = request.title ?? `${base.title} · 下钻`; scene.revision = 0; scene.mapMode = 'scene'; scene.regional = null; scene.exportBoundsMm = { x: 0, y: 0, width: selection.width, height: selection.height }
  // Regional symbol definitions do not cross into the scene map. Remove only
  // assets that lost their last valid reference when the regional partition
  // was removed; assets still used by fixed scene definitions remain intact.
  const retainedAssets = new Set(inspectDependencies(scene).assetIds)
  for (const id of Object.keys(scene.assets)) if (!retainedAssets.has(id)) delete scene.assets[id]
  for (const floor of Object.values(scene.floors)) floor.boundsMm = cloneJson(scene.exportBoundsMm)
  scene.generation = createEmptyGeneration()
  const sourceContentHash = sha256Text(canonicalJson(base)), publicInputHash = sha256Text(canonicalJson({ selection, inherited: publicPayload }))
  const link: SourceRegionLink = { version: 2, id: `source-region-${request.operationId}`, sourceSceneId: base.sceneId, sourceRevision: base.revision, sourceContentHash, selectionMm: cloneJson(selection), translationMm: { x: selection.x === 0 ? 0 : -selection.x, y: selection.y === 0 ? 0 : -selection.y }, publicInputHash, inherited, recipeRefs: [] }
  scene.generation.sourceLinks[link.id] = link
  const result = validateSceneDocument(scene); if (!result.ok) throw new Error(`区域下钻候选无效：${result.errors.map(error => `${error.code}:${error.message}`).join('；')}`)
  const cost = assertTerrainBudget(base, result.document)
  return { request, document: result.document, sourceLink: link, cost, hash: sha256Text(canonicalJson({ request, document: result.document, cost })) }
}

export const prepareRegionalAuthoring = createRegionalDocument
export const applyRegionalEdit = prepareRegionalEdit
export const createRegionalDrillDown = prepareRegionalDrillDown

/** Compatibility façade for the explicit regional panel command. It returns a document,
 * while the prepare* functions above retain cost/hash evidence for workspace adoption. */
export function applyRegionalAuthoring(base: SceneDocument, rawInput: unknown): SceneDocument {
  const request = regionalAuthoringRequestSchema.parse(rawInput)
  if (!request.operations?.length) return createRegionalDocument(base, request).document
  let current = cloneJson(base)
  type Operation = NonNullable<RegionalAuthoringRequest['operations']>[number]
  for (const [index, operation] of request.operations.entries()) {
    const commonFields = { sceneId: current.sceneId, operationId: `${request.operationId}-${index}` }
    let input: unknown
    if (operation.kind === 'area') {
      const value = operation as Extract<Operation, { kind: 'area' }>
      input = { ...commonFields, kind: 'regionalEdit' as const, operation: 'upsertArea' as const, area: { id: value.id, floorId: value.floorId, layerId: value.layerId, visibility: value.visibility ?? 'public' as const, editLocked: value.editLocked ?? false, boundaryMm: value.boundaryMm, kind: value.areaKind, style: value.style, relativeElevationMm: value.relativeElevationMm ?? 0 } }
    } else if (operation.kind === 'line') {
      const value = operation as Extract<Operation, { kind: 'line' }>
      input = { ...commonFields, kind: 'regionalEdit' as const, operation: 'upsertLine' as const, line: { id: value.id, floorId: value.floorId, layerId: value.layerId, visibility: value.visibility ?? 'public' as const, editLocked: value.editLocked ?? false, pointsMm: value.pointsMm.map((positionMm, pointIndex) => ({ id: `${value.id}-point-${pointIndex}`, positionMm })), kind: value.lineKind, displayWidthMm: value.displayWidthMm, actualWidthMm: value.actualWidthMm, portIds: value.portIds ?? [], connectedLineIds: value.connectedLineIds ?? [], flow: value.flow ?? 'none' as const, style: value.style } }
    } else if (operation.kind === 'landmark') {
      const value = operation as Extract<Operation, { kind: 'landmark' }>
      input = { ...commonFields, kind: 'regionalEdit' as const, operation: 'upsertLandmark' as const, landmark: { id: value.id, floorId: value.floorId, layerId: value.layerId, visibility: value.visibility ?? 'public' as const, editLocked: value.editLocked ?? false, positionMm: value.positionMm, purpose: value.purpose, name: value.name, description: value.description, definitionRef: value.definitionRef, areaId: value.areaId ?? null } }
    } else {
      const value = operation as Extract<Operation, { kind: 'symbol' }>
      input = { ...commonFields, kind: 'regionalEdit' as const, operation: 'upsertSymbol' as const, symbol: { id: value.id, floorId: value.floorId, layerId: value.layerId, visibility: value.visibility ?? 'public' as const, editLocked: value.editLocked ?? false, definitionRef: value.definitionRef, positionMm: value.positionMm, visualBoundsMm: value.visualBoundsMm, renderOrder: value.renderOrder, managementKey: value.managementKey ?? null, sourceRef: value.sourceRef ?? null } }
    }
    current = prepareRegionalEdit(current, input).document
  }
  return current
}
