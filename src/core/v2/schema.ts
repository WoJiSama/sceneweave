import { z } from 'zod'
import { inspectJsonInput, sceneSchema } from '../schema'
import { validateDependenciesV2 } from './dependencies'
import { validateGeometryV2 } from './geometry'
import { PROP_OVERRIDE_FIELDS, type Issue, type SceneDocumentV2 } from './types'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留键不能用作 ID')
const int = z.number().finite().refine(Number.isSafeInteger, '必须是安全整数')
const positive = int.refine(value => value > 0)
const nonnegative = int.refine(value => value >= 0)
const rank = int.refine(value => value >= -10000 && value <= 10000)
const angle = z.number().finite().min(0).lt(360)
const opacity = z.number().finite().min(0).max(1)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const point = z.object({ x: int, y: int }).strict()
const size = z.object({ width: positive, height: positive }).strict()
const bounds = z.object({ x: int, y: int, width: positive, height: positive }).strict()
const unique = <T>(values: T[]) => new Set(values.map(value => JSON.stringify(value))).size === values.length
const ids = z.array(id).refine(unique, '引用不能重复')
const strings = z.array(z.string().min(1).max(256)).refine(unique, '文本不能重复')
const versionRef = z.object({ id, version: positive }).strict()
const origin = z.object({ kind: z.enum(['original', 'imported', 'generated']), attribution: z.string(), canEmbed: z.boolean() }).strict()
const identity = { id, catalogId: id, version: positive, licenseRef: id, origin }
const editable = { id, floorId: id, editLocked: z.boolean() }
const visibility = z.enum(['public', 'gm'])
const layer = z.enum(['ground', 'object', 'canopy'])
const shadowClass = z.enum(['none', 'furniture', 'vegetation'])
const shadow = z.object({ directionDeg: angle, offsetMm: nonnegative, blurMm: nonnegative, opacity, color }).strict()
const appearance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), assetId: id, tint: color.nullable(), opacity }).strict(),
  z.object({ kind: z.literal('symbol'), symbol: z.enum(['table', 'chair', 'shelf', 'rug', 'crate']), tint: color.nullable(), opacity }).strict(),
])
const surfaceRef = z.object({ kind: z.enum(['floor', 'terrainArea', 'room']), id }).strict()
const groundRef = z.object({ kind: z.enum(['floor', 'terrainArea']), id }).strict()
const paint = z.object({ materialRef: versionRef, tileSizeMm: size, rotationDeg: angle, alignment: z.enum(['world', 'surface']), originMm: point, tint: color.nullable(), opacity }).strict()
const overlay = z.object({ id, boundaryMm: z.array(point).min(3).max(512), paint, blendWidthMm: nonnegative, renderOrder: rank }).strict()
const style = z.object({ base: paint, overlays: z.array(overlay) }).strict().nullable()
const edgeStyle = z.object({ strokeWidthMm: nonnegative, color, bandWidthMm: nonnegative }).strict()
const templateShape = {
  definitionRef: versionRef.nullable(), appearance, positionMm: point, rotationDeg: angle, visualBoundsMm: bounds,
  footprintMm: size, footprintOffsetMm: point, blocksMovement: z.boolean(), blocksSight: z.boolean(),
  renderLayer: layer, renderOrder: rank, shadowClass, shadowOverride: shadow.nullable(),
}
const overrideFields = z.array(z.enum(PROP_OVERRIDE_FIELDS)).refine(unique, '覆盖字段不能重复')
const entityKind = z.enum(['vertex', 'room', 'wall', 'opening', 'prop', 'region', 'note', 'terrainArea', 'terrainEdge', 'terrainConnection', 'path', 'prefabInstance', 'scatterGroup'])
const anchor = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entity'), entityKind, entityId: id }).strict(),
  z.object({ type: z.literal('point'), positionMm: point }).strict(),
])
const movementCost = z.number().finite().min(1).max(100)
const record = <T extends z.ZodType>(entry: T) => z.record(id, entry)

/** v2 has a separate strict schema. Extending this never relaxes the v1 reader. */
export const sceneSchemaV2 = sceneSchema.extend({
  schemaVersion: z.literal(2), sceneId: id,
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
}).strict()

export type ValidationResultV2 = { ok: true; document: SceneDocumentV2; warnings: Issue[] } | { ok: false; errors: Issue[] }
export function validateSceneV2(input: unknown): ValidationResultV2 {
  // Bound input traversal even for callers bypassing the protected ZIP reader.
  let values = 0
  const budget = (value: unknown, depth = 0): boolean => {
    if (++values > 600000 || depth > 128) return false
    if (value !== null && typeof value === 'object') {
      const descriptors = Object.getOwnPropertyDescriptors(value)
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && key === 'length') continue
        if (!('value' in descriptor) || !budget(descriptor.value, depth + 1)) return false
      }
    }
    return true
  }
  if (!budget(input)) return { ok: false, errors: [{ code: 'JSON_BUDGET', message: '文档超过 128 层/600000 值预算，或包含访问器。' }] }
  const jsonIssue = inspectJsonInput(input)
  if (jsonIssue) return { ok: false, errors: [jsonIssue] }
  const parsed = sceneSchemaV2.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => ({ code: 'SCHEMA', message: `${issue.path.join('.') || 'document'}: ${issue.message}` })) }
  const document = parsed.data as SceneDocumentV2
  const dependencies = validateDependenciesV2(document)
  // Geometry still runs for valid shapes with broken references; its access is guarded.
  const geometry = validateGeometryV2(document)
  const errors = [...dependencies, ...geometry.errors]
  return errors.length ? { ok: false, errors } : { ok: true, document, warnings: geometry.warnings }
}
