import { z } from 'zod'

/** Strict persisted terrain contracts. Algorithms, platform IO and scene validation are separate. */
const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const int = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数毫米')
const positive = int.refine(value => value > 0)
const nonnegative = int.refine(value => value >= 0)
const unit = z.number().finite().min(0).max(1)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const point = z.object({ x: int, y: int }).strict()
const bounds = z.object({ x: int, y: int, width: positive, height: positive }).strict()
const polygon = z.array(point).min(3).max(512)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const visibility = z.enum(['public', 'gm'])
const versionRef = z.object({ id, version: positive }).strict()
const common = { id, floorId: id, layerId: id, visibility, editLocked: z.boolean() }
const unique = <T>(values: T[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length
const keyed = <T extends z.ZodType<{ id: string }>>(schema: T, max: number) => z.record(id, schema).superRefine((items, ctx) => {
  if (Object.keys(items).length > max) ctx.addIssue({ code: 'custom', message: `记录超过${max}项。` })
  for (const [key, value] of Object.entries(items)) if (key !== value.id) ctx.addIssue({ code: 'custom', path: [key], message: '集合键必须等于记录 id。' })
})

export const TERRAIN_CONTRACT_LIMITS = Object.freeze({ rules: 256, records: 8192, regionalEntities: 2048, symbols: 4096,
  edgeRecords: 128, edgePoints: 8192, identityRecords: 65536, normalizedBytes: 4 * 1024 * 1024 })
export const generationFieldGroupSchema = z.enum(['geometry', 'properties', 'surface', 'appearance', 'membership', 'exclusions', 'presentation', 'source'])
export const generationReferenceSchema = z.object({ kind: z.enum(['terrainArea', 'terrainPoint', 'terrainSegment', 'terrainEdge', 'terrainConnection', 'path',
  'prop', 'scatterGroup', 'scatterMember', 'surfaceOverlay', 'visualBoundary', 'visualEdgeLook', 'materializedEdge', 'regionalArea', 'regionalLine', 'regionalLandmark', 'regionalSymbol']),
  entityId: id, parentId: id.nullable(), fieldGroup: generationFieldGroupSchema }).strict()
const referenceList = z.array(generationReferenceSchema).max(8192).refine(unique, '引用不能重复')
export const generationParametersSchema = z.object({ widthMm: nonnegative, minWidthMm: nonnegative, maxWidthMm: nonnegative,
  roughness: unit, densityFactor: unit }).strict().refine(value => value.minWidthMm <= value.maxWidthMm, '宽度范围无效')
export const generationRecipeSchema = z.object({ id, recipeVersion: positive, algorithmId: id, algorithmVersion: positive,
  mapMode: z.enum(['scene', 'regional']), seed: z.string().min(1).max(128),
  parameters: z.object({ terrainKind: z.enum(['island', 'coast', 'river', 'lake', 'forest', 'hill', 'mixed']),
    seaElevationMm: int, landElevationMm: int, plateauElevationMm: int, roughness: unit, densityFactor: unit,
    baySide: z.enum(['north', 'east', 'south', 'west']) }).strict(),
  materials: z.array(z.object({ role: z.enum(['water', 'sand', 'soil', 'grass', 'rock', 'path']), ref: versionRef }).strict()).max(32).refine(unique),
  props: z.array(z.object({ role: z.enum(['tree', 'rock', 'shrub', 'debris']), ref: versionRef }).strict()).max(64).refine(unique),
  precision: z.object({ sampleSpacingMm: positive, toleranceMm: positive, noiseCellMm: positive }).strict(),
}).strict()
export const generationIntentSchema = z.object({ id, floorId: id, visibility, boundsMm: bounds,
  skeleton: z.array(z.object({ id, kind: z.enum(['landmass', 'plateau', 'bay', 'channel', 'ridge', 'forest']),
    positionMm: point, radiusMm: positive, directionDeg: z.number().finite().min(0).lt(360) }).strict()).max(128),
  constraintIds: z.array(id).max(256).refine(unique), preserveIds: z.array(id).max(256).refine(unique),
}).strict()
export const generationRuleSchema = z.object({ ...common, kind: z.enum(['terrain', 'transition', 'edge', 'scatter', 'route', 'regional']),
  recipeRef: versionRef, inputs: referenceList, outputs: referenceList, parameters: generationParametersSchema,
  state: z.enum(['active', 'paused', 'detached']), inputHash: hash, managedOutputHash: hash,
}).strict()
export const outputOwnershipSchema = z.object({ id, outputKey: id, ruleId: id, target: generationReferenceSchema,
  managedFields: z.array(generationFieldGroupSchema).max(8).refine(unique), manualFields: z.array(generationFieldGroupSchema).max(8).refine(unique),
  state: z.enum(['managed', 'manual', 'deleted', 'detached']), birthToken: id,
}).strict().refine(value => value.managedFields.every(field => !value.manualFields.includes(field)), '人工字段不能同时受规则管理')
export const generationExclusionSchema = z.object({ id, key: id, floorId: id, visibility, boundaryMm: polygon,
  reason: z.enum(['manual', 'delete', 'detach', 'entrance', 'constraint']), candidateKey: id.nullable(), birthToken: id.nullable(),
}).strict()
const constraintBase = { id, floorId: id, visibility, strength: z.enum(['hard', 'soft']) }
export const terrainConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ ...constraintBase, kind: z.literal('activityArea'), boundaryMm: polygon, clearanceMm: nonnegative }).strict(),
  z.object({ ...constraintBase, kind: z.literal('route'), pointsMm: z.array(point).min(2).max(128), minWidthMm: positive }).strict(),
  z.object({ ...constraintBase, kind: z.literal('port'), positionMm: point, directionDeg: z.number().finite().min(0).lt(360), widthMm: positive }).strict(),
  z.object({ ...constraintBase, kind: z.literal('preserveGeometry'), target: generationReferenceSchema, geometryHash: hash }).strict(),
  z.object({ ...constraintBase, kind: z.literal('preserveEntity'), target: generationReferenceSchema, contentHash: hash }).strict(),
])
export const constraintCheckSchema = z.object({ id, constraintId: id, state: z.enum(['passed', 'failed', 'unchecked']),
  algorithmId: id, algorithmVersion: positive, inputHash: hash,
  issues: z.array(z.object({ code: id, message: z.string().min(1).max(512), entityId: id.nullable() }).strict()).max(128),
}).strict()
export const regionalSymbolDefinitionSchema = z.object({ id, catalogId: id, version: positive, name: z.string().min(1).max(120),
  assetId: id, licenseRef: id, origin: z.object({ kind: z.enum(['original', 'imported', 'generated']), attribution: z.string().min(1).max(2000), canEmbed: z.boolean() }).strict(),
  visualBoundsMm: bounds, rootAnchorMm: point, orientation: z.literal('upright') }).strict()
const inheritedSourceFeatureSchema = z.object({ id, kind: z.enum(['area', 'line', 'landmark', 'port']),
  sourceEntityId: id, visibility, pointsMm: z.array(point).min(1).max(512),
  terrainKind: z.enum(['land', 'water', 'forest', 'hill', 'river', 'ridge', 'road', 'landmark', 'symbol', 'port']),
  widthMm: nonnegative, elevationMm: int.nullable(), precisionMm: positive, estimated: z.boolean(),
}).strict()
const inheritedSourceLandmarkV2Schema = inheritedSourceFeatureSchema.extend({ kind: z.literal('landmark'),
  landmark: z.object({ positionMm: point, purpose: z.enum(['settlement', 'ruin', 'camp', 'natural', 'other']), name: z.string().min(1).max(120),
    description: z.string().max(2000), definitionRef: versionRef, areaId: id.nullable(), definition: regionalSymbolDefinitionSchema }).strict(),
}).strict()
const inheritedSourceSymbolV2Schema = inheritedSourceFeatureSchema.extend({ kind: z.literal('symbol'),
  symbol: z.object({ definitionRef: versionRef, definition: regionalSymbolDefinitionSchema, positionMm: point, visualBoundsMm: bounds,
    orientation: z.literal('upright'), renderOrder: int, managementKey: id.nullable(),
    sourceRef: z.object({ kind: z.enum(['area', 'line', 'landmark']), id }).strict().nullable() }).strict(),
}).strict()
const inheritedSourcePortV2Schema = inheritedSourceFeatureSchema.extend({ kind: z.literal('port'), directionDeg: z.number().finite().min(0).lt(360) }).strict()
const inheritedSourceFeatureV2Schema = z.union([
  inheritedSourceFeatureSchema.extend({ kind: z.enum(['area', 'line']) }).strict(),
  inheritedSourceLandmarkV2Schema,
  inheritedSourceSymbolV2Schema,
  inheritedSourcePortV2Schema,
])
const sourceRegionLinkV1Schema = z.object({ id, sourceSceneId: id, sourceRevision: nonnegative, sourceContentHash: hash,
  selectionMm: bounds, translationMm: point, publicInputHash: hash,
  inherited: z.array(inheritedSourceFeatureSchema).max(2048), recipeRefs: z.array(versionRef).max(256),
}).strict()
const sourceRegionLinkV2Schema = z.object({ version: z.literal(2), id, sourceSceneId: id, sourceRevision: nonnegative, sourceContentHash: hash,
  selectionMm: bounds, translationMm: point, publicInputHash: hash,
  inherited: z.array(inheritedSourceFeatureV2Schema).max(2048), recipeRefs: z.array(versionRef).max(256),
}).strict()
export const sourceRegionLinkSchema = z.union([sourceRegionLinkV1Schema, sourceRegionLinkV2Schema])
export type SourceRegionLink = z.infer<typeof sourceRegionLinkSchema>
export type SourceRegionFeature = z.infer<typeof inheritedSourceFeatureV2Schema>
const generationFields = { recipes: keyed(generationRecipeSchema, 256), intents: keyed(generationIntentSchema, 256),
  rules: keyed(generationRuleSchema, TERRAIN_CONTRACT_LIMITS.rules), ownership: keyed(outputOwnershipSchema, TERRAIN_CONTRACT_LIMITS.records),
  exclusions: keyed(generationExclusionSchema, TERRAIN_CONTRACT_LIMITS.records), constraints: keyed(terrainConstraintSchema, 256),
  checks: keyed(constraintCheckSchema, 256), sourceLinks: keyed(sourceRegionLinkSchema, 256),
}
const refineGeneration = (value: { recipes: Record<string, GenerationRecipe>; rules: Record<string, GenerationRule>; ownership: Record<string, OutputOwnership>; checks: Record<string, z.infer<typeof constraintCheckSchema>>; constraints: Record<string, TerrainConstraint>; intents: Record<string, GenerationIntent> }, ctx: z.RefinementCtx) => {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  const outputs = new Set<string>(), keys = new Set<string>()
  for (const rule of Object.values(value.rules)) {
    const recipe = value.recipes[rule.recipeRef.id]
    if (!recipe || recipe.recipeVersion !== rule.recipeRef.version) fail(['rules', rule.id, 'recipeRef'], '固定配方引用缺失或版本不符。')
    for (const output of rule.outputs) {
      const key = JSON.stringify(output)
      if (rule.state !== 'detached' && outputs.has(key)) fail(['rules', rule.id, 'outputs'], '同一字段组不能被多个规则写入。')
      if (rule.state !== 'detached') outputs.add(key)
    }
  }
  for (const row of Object.values(value.ownership)) {
    if (!value.rules[row.ruleId]) fail(['ownership', row.id, 'ruleId'], '输出所有权规则缺失。')
    if (keys.has(row.outputKey)) fail(['ownership', row.id, 'outputKey'], '输出稳定key重复。')
    keys.add(row.outputKey)
  }
  for (const row of Object.values(value.checks)) if (!value.constraints[row.constraintId]) fail(['checks', row.id, 'constraintId'], '约束检查引用缺失。')
  for (const row of Object.values(value.intents)) for (const key of row.constraintIds) if (!value.constraints[key]) fail(['intents', row.id, 'constraintIds'], '意图约束引用缺失。')
  const writers = new Map<string, string>()
  for (const rule of Object.values(value.rules)) if (rule.state !== 'detached') for (const ref of rule.outputs) writers.set(JSON.stringify(ref), rule.id)
  const visiting = new Set<string>(), visited = new Set<string>()
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return false
    if (visited.has(key)) return true
    visiting.add(key)
    for (const ref of value.rules[key].inputs) { const parent = writers.get(JSON.stringify(ref)); if (parent && !visit(parent)) return false }
    visiting.delete(key); visited.add(key); return true
  }
  if (Object.keys(value.rules).some(key => !visit(key))) fail(['rules'], '生成依赖图存在循环。')
}
export const generationV1Schema = z.object({ version: z.literal(1), ...generationFields }).strict().superRefine(refineGeneration)
export const normalizedTerrainStrokeSchema = z.object({ id, operationId: id, strokeIndex: int.min(0).max(31), floorId: id, visibility,
  brush: z.enum(['addLand', 'digWater', 'paintGrass', 'clearArea']), targetAreaId: id,
  pointsMm: z.array(point).min(1).max(512), radiusMm: int.min(100).max(10000), scopeMm: bounds,
  linkMode: z.enum(['contour', 'transitions', 'scenery']), materialRef: versionRef.nullable(), elevationMm: int.nullable(),
  algorithmId: z.literal('terrain-edit'), algorithmVersion: z.literal(1),
}).strict()
export const generationV2Schema = z.object({ version: z.literal(2), ...generationFields, strokes: keyed(normalizedTerrainStrokeSchema, 8192) }).strict().superRefine(refineGeneration)
export const surroundingsPreservationSchema = z.object({ collection: z.enum(['vertices', 'rooms', 'walls', 'openings', 'paths', 'terrainConnections', 'props', 'notes', 'prefabInstances', 'scatterGroups']), entityId: id, contentHash: hash }).strict()
export const surroundingsOperationSchema = z.object({ id, operationId: id, floorId: id, visibility: z.literal('gm'),
  algorithmId: z.literal('terrain-surroundings'), algorithmVersion: z.literal(1), seed: z.string().min(1).max(128), scopeMm: bounds,
  maxDisplacementMm: int.min(10).max(1500), boundaryIds: z.array(id).min(1).max(32).refine(unique), regenerateScenery: z.boolean(),
  preserved: z.array(surroundingsPreservationSchema).max(256), state: z.enum(['current', 'historical']), inputHash: hash, outputHash: hash,
}).strict().refine(row => unique(row.preserved.map(item => [item.collection, item.entityId])), '保全见证不能重复')
export const generationV3Schema = z.object({ version: z.literal(3), ...generationFields, strokes: keyed(normalizedTerrainStrokeSchema, 8192),
  surroundings: keyed(surroundingsOperationSchema, 256) }).strict().superRefine(refineGeneration)
export const terrainTopologyRequestSchema = z.object({ kind: z.literal('topology'), sceneId: id, operationId: id, floorId: id, scopeMm: bounds,
  linkMode: z.literal('transitions'), operation: z.enum(['union', 'difference', 'intersection']), areaIds: z.array(id).min(1).max(8).refine(unique), templateAreaId: id,
  clip: z.array(polygon).min(1).max(32), holeSurface: z.object({ materialRef: versionRef, elevationMm: int, blocksMovement: z.boolean(), movementCostMultiplier: z.number().finite().min(.1).max(100) }).strict(),
  rebindings: z.array(z.object({ kind: z.enum(['prop', 'room', 'path', 'connectionFrom', 'connectionTo', 'note']), entityId: id, previousAreaId: id, outputIndex: int.min(0).max(127) }).strict()).max(128).refine(unique),
}).strict()
export type TerrainTopologyRequest = z.infer<typeof terrainTopologyRequestSchema>
export const topologyOperationSchema = z.object({ id, floorId: id, visibility: z.literal('gm'), algorithmId: z.literal('terrain-boolean'), algorithmVersion: z.literal(1),
  request: terrainTopologyRequestSchema, inputs: z.array(z.object({ entityId: id, contentHash: hash, boundaryMm: polygon }).strict()).min(1).max(8),
  outputAreaIds: z.array(id).min(1).max(128).refine(unique), componentCount: int.min(1).max(128), holeCount: int.min(0).max(128),
  state: z.enum(['current', 'historical']), inputHash: hash, outputHash: hash,
}).strict()
export type TopologyOperation = z.infer<typeof topologyOperationSchema>
const topologyFields = { ...generationFields, strokes: keyed(normalizedTerrainStrokeSchema, 8192), surroundings: keyed(surroundingsOperationSchema, 256), topology: keyed(topologyOperationSchema, 256) }
export const generationV4Schema = z.object({ version: z.literal(4), ...topologyFields }).strict().superRefine(refineGeneration)
export const generationSchema = z.union([generationV1Schema, generationV2Schema, generationV3Schema, generationV4Schema])
/** Compatibility name denotes the supported strict version union. */
export type GenerationSystem1 = z.infer<typeof generationSchema>
export type GenerationSystem2 = z.infer<typeof generationV2Schema>
export type GenerationSystem3 = z.infer<typeof generationV3Schema>
export type GenerationSystem4 = z.infer<typeof generationV4Schema>
export type SurroundingsOperation = z.infer<typeof surroundingsOperationSchema>
export type NormalizedTerrainStroke = z.infer<typeof normalizedTerrainStrokeSchema>
export type GenerationRecipe = z.infer<typeof generationRecipeSchema>
export type GenerationIntent = z.infer<typeof generationIntentSchema>
export type GenerationRule = z.infer<typeof generationRuleSchema>
export type GenerationReference = z.infer<typeof generationReferenceSchema>
export type GenerationFieldGroup = z.infer<typeof generationFieldGroupSchema>
export type OutputOwnership = z.infer<typeof outputOwnershipSchema>
export type TerrainConstraint = z.infer<typeof terrainConstraintSchema>
export function createEmptyGeneration(): GenerationSystem1 {
  return { version: 1, recipes: {}, intents: {}, rules: {}, ownership: {}, exclusions: {}, constraints: {}, checks: {}, sourceLinks: {} }
}

const regionalStyle = z.object({ fill: color, stroke: color, strokeWidthMm: nonnegative, opacity: unit }).strict()
export const regionalAreaSchema = z.object({ ...common, boundaryMm: polygon, kind: z.enum(['land', 'water', 'forest', 'hill']),
  style: regionalStyle, relativeElevationMm: int.nullable() }).strict()
export const regionalLineSchema = z.object({ ...common, pointsMm: z.array(z.object({ id, positionMm: point }).strict()).min(2).max(512),
  kind: z.enum(['river', 'ridge', 'road']), displayWidthMm: positive, actualWidthMm: positive.nullable(),
  portIds: z.array(id).max(32).refine(unique), connectedLineIds: z.array(id).max(128).refine(unique),
  flow: z.enum(['forward', 'reverse', 'none']), style: regionalStyle }).strict()
export const regionalLandmarkSchema = z.object({ ...common, positionMm: point, purpose: z.enum(['settlement', 'ruin', 'camp', 'natural', 'other']),
  name: z.string().min(1).max(120), description: z.string().max(2000), definitionRef: versionRef, areaId: id.nullable() }).strict()
export const regionalSymbolSchema = z.object({ ...common, definitionRef: versionRef, positionMm: point, visualBoundsMm: bounds,
  orientation: z.literal('upright'), renderOrder: int, managementKey: id.nullable(),
  sourceRef: z.object({ kind: z.enum(['area', 'line', 'landmark']), id }).strict().nullable() }).strict()
export const presentationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('topDown'), rootAnchorMm: point, orientation: z.literal('rotateWithGround'), groundShadowMm: polygon.nullable() }).strict(),
  z.object({ mode: z.literal('nearSide'), rootAnchorMm: point, orientation: z.literal('fixedUpright'), fixedRotationDeg: z.literal(0),
    footprintAxes: z.literal('world'), groundShadowMm: polygon.nullable() }).strict(),
])
export const presentationRecordSchema = z.record(id, presentationSchema)
export type FixedPresentation = z.infer<typeof presentationSchema>
export const cartographicProfileSchema = z.object({ id, version: positive, lineWidthMm: positive, symbolScale: z.number().finite().min(.1).max(10),
  landColor: color, waterColor: color, forestColor: color, hillColor: color, simplificationErrorMm: positive }).strict()
export const regionalSchema = z.object({ version: z.literal(1), areas: keyed(regionalAreaSchema, 2048), lines: keyed(regionalLineSchema, 2048),
  landmarks: keyed(regionalLandmarkSchema, 2048), symbols: keyed(regionalSymbolSchema, 4096),
  symbolDefinitions: keyed(regionalSymbolDefinitionSchema, 4096), profile: cartographicProfileSchema,
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.areas).length + Object.keys(value.lines).length + Object.keys(value.landmarks).length > TERRAIN_CONTRACT_LIMITS.regionalEntities) ctx.addIssue({ code: 'custom', message: '区域面线地标合计超过2048项。' })
})
export type RegionalModel1 = z.infer<typeof regionalSchema>
export function createEmptyRegional(): RegionalModel1 {
  return { version: 1, areas: {}, lines: {}, landmarks: {}, symbols: {}, symbolDefinitions: {},
    profile: { id: 'cartographic-neutral-1', version: 1, lineWidthMm: 20000, symbolScale: 1,
      landColor: '#B8BE86', waterColor: '#86B2B7', forestColor: '#617C58', hillColor: '#9E9577', simplificationErrorMm: 10000 } }
}

export const materializedEdgeSchema = z.object({ ...common, boundaryId: id, inputHash: hash, kind: z.enum(['shore', 'cliff', 'grass', 'path']),
  polygons: z.array(polygon).max(128), strokes: z.array(z.object({ id, pointsMm: z.array(point).min(2).max(512),
    widthMm: positive, color, opacity: unit }).strict()).max(256), materialRef: versionRef.nullable(), fillColor: color, opacity: unit,
}).strict().superRefine((value, ctx) => {
  const total = value.polygons.reduce((sum, ring) => sum + ring.length, 0) + value.strokes.reduce((sum, stroke) => sum + stroke.pointsMm.length, 0)
  if (total > TERRAIN_CONTRACT_LIMITS.edgePoints) ctx.addIssue({ code: 'custom', message: '物化边缘几何超过8192点。' })
  if (!value.polygons.length && !value.strokes.length) ctx.addIssue({ code: 'custom', message: '物化边缘必须有明确几何。' })
})
export function createVisual2Schema<T extends z.ZodType>(base: T) {
  return z.object({ version: z.literal(2), base, materializedEdges: keyed(materializedEdgeSchema, TERRAIN_CONTRACT_LIMITS.edgeRecords) }).strict()
}
export type MaterializedEdge = z.infer<typeof materializedEdgeSchema>
export interface VisualSystem2<TBase> { version: 2; base: TBase; materializedEdges: Record<string, MaterializedEdge> }

export const GENERATION_IDENTITY_KINDS = ['generationRecipe', 'generationIntent', 'generationSkeleton', 'generationRule', 'outputOwnership',
  'generationExclusion', 'generationStroke', 'surroundingsOperation', 'topologyOperation', 'terrainConstraint', 'constraintCheck', 'sourceRegionLink', 'sourceRegionFeature'] as const
export const REGIONAL_IDENTITY_KINDS = ['regionalArea', 'regionalLine', 'regionalPoint', 'regionalLandmark', 'regionalSymbol'] as const
export const PRESENTATION_IDENTITY_KINDS = ['surfaceOverlay', 'materializedEdge', 'materializedStroke'] as const
export const extendedIdentityTokenSchema = z.object({ kind: z.enum([...GENERATION_IDENTITY_KINDS, ...REGIONAL_IDENTITY_KINDS, ...PRESENTATION_IDENTITY_KINDS]),
  token: id, topologyToken: id, topologyHash: hash }).strict()
export const identity2Fields = { generationTokens: z.record(id, extendedIdentityTokenSchema.extend({ kind: z.enum(GENERATION_IDENTITY_KINDS) })),
  regionalTokens: z.record(id, extendedIdentityTokenSchema.extend({ kind: z.enum(REGIONAL_IDENTITY_KINDS) })),
  presentationTokens: z.record(id, extendedIdentityTokenSchema.extend({ kind: z.enum(PRESENTATION_IDENTITY_KINDS) })) }
export type ExtendedIdentityToken = z.infer<typeof extendedIdentityTokenSchema>
export function createEmptyIdentity2Fields() { return { generationTokens: {}, regionalTokens: {}, presentationTokens: {} } }
