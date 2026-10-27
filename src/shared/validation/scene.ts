import { createVisual2Schema, generationSchema, regionalSchema } from '../terrain-generation/contracts.js'
import { validateTerrainContracts } from '../terrain-generation/integrity.js'
import { z } from 'zod'
import { visualSystemSchema } from '../visual/schema.js'
import { validateVisualSystem } from '../visual/diagnostics.js'
import { inspectJsonInput } from './json.js'
import { validateGeometry } from '../geometry/geometry.js'
import { geometryDocumentForValidation } from '../commands/domain.js'
import { inspectDependencies } from '../commands/dependencies.js'
import { USER_LAYER_LIMIT, type SceneDocument, type Issue } from '../model/scene.js'
import {
  id, int, positive, nonnegative, rank, angle, opacity, color, point, size, bounds, unique, ids, strings,
  versionRef, origin, identity, editable, visibility, layer, shadowClass, shadow, appearance, surfaceRef, groundRef,
  style, edgeStyle, templateShape, overrideFields, anchor, movementCost, record, timestamp,
} from './primitives.js'

export const userLayerSchema = z.object({
  id, floorId: id, name: z.string().min(1).max(80).refine(value => value.trim() === value && value.length > 0, '图层名称须去除首尾空白且非空'),
  order: z.number().int().min(0).max(USER_LAYER_LIMIT - 1), editLocked: z.boolean(),
}).strict()

/** Every persisted field is native and strict, including all fixed definitions and layers. */
export const sceneDocumentSchema = z.object({
  format: z.literal('sceneweave-scene'), schemaVersion: z.union([z.literal(1), z.literal(2)]), sceneId: id, revision: nonnegative,
  title: z.string().min(1), createdAt: timestamp, updatedAt: timestamp,
  units: z.object({ world: z.literal('mm'), display: z.enum(['m', 'ft']), gridSizeMm: positive, snapMm: positive, gridVisible: z.boolean() }).strict(),
  exportBoundsMm: bounds,
  floors: record(z.object({ id, name: z.string(), boundsMm: bounds }).strict()),
  vertices: record(z.object({ ...editable, xMm: int, yMm: int }).strict()),
  regions: record(z.object({ ...editable, boundaryMm: z.array(point).min(3), kind: z.enum(['terrain', 'hazard', 'manualMask']),
    blocksMovement: z.boolean(), movementCostMultiplier: z.number().finite().min(1), visibility }).strict()),
  generationMetadata: z.object({ generatorVersion: z.string(), seed: z.string(), summary: z.string().optional(), adoptedAt: timestamp }).strict().optional(),

  assets: record(z.object({ id, sha256: z.string().regex(/^[a-f0-9]{64}$/), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    pixelWidth: positive, pixelHeight: positive, logicalSizeMm: size, licenseRef: id, origin }).strict()),
  presetSnapshot: z.object({ presetId: id, presetVersion: positive, distanceMode: z.enum(['metric', 'grid', 'abstract']), source: z.string(), gridSizeMm: positive }).strict(),
  rooms: record(z.object({ ...editable, boundaryVertexIds: ids.min(3).max(256), purpose: z.string(), visibility,
    accessExpectation: z.enum(['unspecified', 'required', 'intentionalIsolation']), supportRef: groundRef, groundElevationMm: int, floorStyle: style }).strict()),
  walls: record(z.object({ ...editable, startVertexId: id, endVertexId: id, thicknessMm: positive, blocksMovement: z.boolean(), blocksSight: z.boolean(), topStyle: style }).strict()),
  openings: record(z.object({ ...editable, wallId: id, offsetReferenceVertexId: id, offsetMm: nonnegative, widthMm: positive,
    kind: z.enum(['door', 'window']), state: z.enum(['open', 'closed']), locked: z.boolean(), secret: z.boolean(), revealed: z.boolean() }).strict()),
  props: record(z.object({ ...editable, ...templateShape, visibility, supportRef: surfaceRef, roomId: id.optional() }).strict()),
  notes: record(z.object({ ...editable, anchor, kind: z.enum(['note', 'clue', 'label']), title: z.string().optional(), text: z.string(), visibility, discovered: z.boolean().optional() }).strict()),
  propDefinitions: record(z.object({ ...identity, name: z.string(), tags: strings, defaultAppearance: appearance, defaultVisualBoundsMm: bounds,
    defaultFootprintMm: size, defaultFootprintOffsetMm: point, defaultBlocksMovement: z.boolean(), defaultBlocksSight: z.boolean(), defaultRenderLayer: layer, defaultShadowClass: shadowClass }).strict()),
  materials: record(z.object({ ...identity, name: z.string(), tags: strings, textureAssetId: id, defaultTileSizeMm: size,
    applicableSurfaces: z.array(z.enum(['room', 'wall', 'terrain', 'path'])).min(1).refine(unique, '适用表面不能重复') }).strict()),
  terrainAreas: record(z.object({ ...editable, visibility, boundaryMm: z.array(z.object({ id, segmentId: id, positionMm: point }).strict()).min(3).max(2048),
    groundElevationMm: int, coveragePriority: rank, surfaceStyle: style, blocksMovement: z.boolean(), blocksSight: z.boolean(), movementCostMultiplier: movementCost }).strict()),
  terrainEdges: record(z.object({ ...editable, visibility, source: z.object({ areaId: id, segmentId: id }).strict(), neighborAreaId: id.nullable(),
    kind: z.enum(['shore', 'cliff', 'materialTransition']), shoreline: z.boolean(), blocksMovement: z.boolean(), blocksSight: z.boolean(), surfaceStyle: style, styleOverride: edgeStyle.nullable() }).strict()),
  terrainConnections: record(z.object({ ...editable, visibility, kind: z.enum(['stairs', 'ramp']), from: z.object({ surfaceRef, positionMm: point }).strict(), to: z.object({ surfaceRef, positionMm: point }).strict(),
    widthMm: positive, openingId: id.nullable(), blocksMovement: z.boolean(), movementCostMultiplier: movementCost, surfaceStyle: style }).strict()),
  paths: record(z.object({ ...editable, visibility, centerlineMm: z.array(point).min(2).max(256), widthMm: positive, supportRefs: z.array(surfaceRef).min(1).refine(unique, '支撑引用不能重复'),
    surfaceStyle: style, movementCostMultiplier: movementCost, renderOrder: rank }).strict()),
  prefabDefinitions: record(z.object({ ...identity, name: z.string(), tags: strings, members: z.array(z.object({ key: id, propTemplate: z.object(templateShape).strict() }).strict()).min(1).max(128) }).strict()),
  prefabInstances: record(z.object({ ...editable, visibility, definitionRef: versionRef, anchorMm: point, rotationDeg: angle,
    members: record(z.object({ propId: id.nullable(), overrideFields }).strict()) }).strict()),
  scatterGroups: record(z.object({ ...editable, visibility,
    domain: z.discriminatedUnion('kind', [z.object({ kind: z.literal('area'), areaId: id }).strict(), z.object({ kind: z.literal('path'), pathId: id }).strict(), z.object({ kind: z.literal('edgeBand'), edgeId: id, widthMm: positive }).strict()]),
    palette: z.array(z.object({ key: id, propDefinitionRef: versionRef, weight: positive }).strict()).min(1), seed: z.string().min(1).max(128), algorithmVersion: id,
    gridOriginMm: point, cellSizeMm: positive, densityFactor: opacity, minDistanceMm: positive,
    rotationRangeDeg: z.object({ min: angle, max: angle }).strict().refine(value => value.min <= value.max),
    members: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.object({ propId: id.nullable(), state: z.enum(['managed', 'manual', 'deleted', 'detached']), overrideFields }).strict()),
    exclusions: z.array(z.object({ id, boundaryMm: z.array(point).min(3).max(512), reason: z.enum(['manual', 'delete', 'entrance']), sourceCandidateKey: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()).max(10000),
  }).strict()),
  styleThemes: record(z.object({ ...identity, name: z.string(), materialSuggestions: z.array(versionRef).refine(unique), propSuggestions: z.array(versionRef).refine(unique), prefabSuggestions: z.array(versionRef).refine(unique),
    outline: z.object({ widthMm: nonnegative, color }).strict(),
    openingStyle: z.object({ doorStrokeWidthMm: nonnegative, windowStrokeWidthMm: nonnegative, frameWidthMm: nonnegative, doorFill: color, windowFill: color }).strict(),
    edgeStyles: z.object({ shore: edgeStyle, cliff: edgeStyle, materialTransition: edgeStyle, path: edgeStyle }).strict(),
    shadowPresets: z.object({ none: shadow, furniture: shadow, vegetation: shadow, wall: shadow }).strict(),
    terrainCliff: z.object({ directionDeg: angle, offsetFactor: opacity, maxOffsetMm: nonnegative, blurMm: nonnegative, opacity, color }).strict(),
  }).strict()),
  activeStyleThemeRef: versionRef.nullable(),
  constraints: z.object({ entranceOpeningIds: ids, wallEndClearanceMm: nonnegative, minDoorWidthMm: positive.optional(), minPathWidthMm: positive.optional(),
    pathChecks: z.array(z.object({ id, from: anchor, to: anchor, clearanceMm: positive, mode: z.enum(['structural', 'current']), assumedOpenDoorIds: ids }).strict()) }).strict(),

  userLayers: record(userLayerSchema), entityLayers: record(id), visual: visualSystemSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.schemaVersion === 1 && value.visual !== undefined) context.addIssue({ code: 'custom', path: ['visual'], message: '原生v1不得携带视觉字段；请显式升级。' })
  if (value.schemaVersion === 2 && value.visual === undefined) context.addIssue({ code: 'custom', path: ['visual'], message: '原生v2须携带完整视觉系统。' })
})

/** New persisted contract; old strict object and its reusable shape stay unchanged. */
export const sceneDocument3Schema = z.object({ ...sceneDocumentSchema.shape,
  schemaVersion: z.literal(3), visual: createVisual2Schema(visualSystemSchema),
  mapMode: z.enum(['scene', 'regional']), generation: generationSchema, regional: regionalSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.mapMode === 'scene') !== (value.regional === null)) ctx.addIssue({ code: 'custom', message: '场景模式不携带区域数据，区域模式必须携带regional。' })
  if (value.mapMode === 'regional' && ['vertices','rooms','walls','openings','props','terrainAreas','terrainEdges','terrainConnections','paths','prefabInstances','scatterGroups','regions'].some(key => Object.keys(value[key as 'props']).length)) ctx.addIssue({ code: 'custom', message: '区域模式不得携带物理场景实体。' })
})
export const nativeSceneSchema = z.union([sceneDocumentSchema, sceneDocument3Schema])

export type ValidationResult = { ok: true; document: SceneDocument; warnings: Issue[] } | { ok: false; errors: Issue[] }
export function validateSceneDocument(input: unknown): ValidationResult {
  // The ownership inspector already enforces the complete depth/value budget
  // and descriptors. Preserve scene error codes without scanning twice.
  const jsonIssue = inspectJsonInput(input, { budgetCode: 'JSON_BUDGET', accessorCode: 'JSON_BUDGET' })
  if (jsonIssue) return { ok: false, errors: [jsonIssue] }
  const parsed = nativeSceneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'SCHEMA', message: `${issue.path.join('.') || 'document'}: ${issue.message}` })) }
  const document = parsed.data as SceneDocument
  const dependencies = inspectDependencies(document), geometry = validateGeometry(geometryDocumentForValidation(document))
  const errors = [...dependencies.errors, ...geometry.errors, ...validateVisualSystem(document), ...validateTerrainContracts(document)]
  return errors.length ? { ok: false, errors } : { ok: true, document, warnings: geometry.warnings }
}
export const sceneSchema = sceneDocumentSchema
export const validateScene = validateSceneDocument
