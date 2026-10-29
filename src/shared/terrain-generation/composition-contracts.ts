import { z } from 'zod'
import { createEmptyGeneration, generationSchema } from './contracts.js'
import type { VisualSystem2 } from './contracts.js'
import type { VisualSystem } from '../visual/types.js'
import type { SceneDocument } from '../model/scene.js'
import type { GenerationSystem1, RegionalModel1 } from './contracts.js'

const id = z.string().min(1).max(256).refine(value => value !== '__proto__', '保留 ID')
const int = z.number().finite().refine(value => Number.isSafeInteger(value), '必须是安全整数')
const positive = int.refine(value => value > 0, '必须为正数')
const nonnegative = int.refine(value => value >= 0, '不能为负数')
const hash = z.string().regex(/^[a-f0-9]{64}$/, '必须是小写 SHA256')
const visibility = z.enum(['public', 'gm'])
const point = z.object({ x: int, y: int }).strict()
const bounds = z.object({ x: int, y: int, width: positive, height: positive }).strict()
const common = { id, floorId: id, layerId: id, visibility, editLocked: z.boolean() }
const unique = <T>(items: T[]) => new Set(items.map(item => JSON.stringify(item))).size === items.length
const keyed = <T extends z.ZodType<{ id: string }>>(schema: T, max: number) => z.record(id, schema).superRefine((items, ctx) => {
  if (Object.keys(items).length > max) ctx.addIssue({ code: 'custom', message: `记录超过${max}项。` })
  for (const [key, value] of Object.entries(items)) if (key !== value.id) ctx.addIssue({ code: 'custom', path: [key], message: '集合键必须等于记录 id。' })
})

export const generationReferenceV5Schema = z.object({ kind: z.enum(['terrainArea', 'terrainPoint', 'terrainSegment', 'terrainEdge', 'terrainConnection', 'path', 'prop', 'scatterGroup', 'scatterMember', 'surfaceOverlay', 'visualBoundary', 'visualEdgeLook', 'materializedEdge', 'regionalArea', 'regionalLine', 'regionalLandmark', 'regionalSymbol', 'vertex', 'room', 'wall', 'opening', 'note', 'prefabInstance']), entityId: id, parentId: id.nullable(), fieldGroup: z.enum(['geometry', 'properties', 'surface', 'appearance', 'membership', 'exclusions', 'presentation', 'source']) }).strict().superRefine((ref,ctx)=>{
  if (['terrainPoint','terrainSegment','scatterMember','surfaceOverlay'].includes(ref.kind) === (ref.parentId === null)) ctx.addIssue({code:'custom',path:['parentId'],message:'内嵌引用必须提供parentId，顶层引用必须为null。'})
})

const ellipse = z.object({ kind: z.literal('ellipse'), centerMm: point, radiusXMm: positive, radiusYMm: positive, rotationMilliDeg: int.min(0).max(359999) }).strict()
const corridor = z.object({ kind: z.literal('corridor'), pointsMm: z.array(point).min(2).max(32), widthMm: positive }).strict()
const featureCommon = { ...common,elevationMm:int,roughnessPpm:int.min(0).max(1_000_000),seedKey:z.string().min(1).max(128) }
export const terrainFeatureSchema = z.union([
  z.object({...featureCommon,kind:z.enum(['landmass','lakeBasin','forest','clearing','plateau']),shape:ellipse}).strict(),
  z.object({...featureCommon,kind:z.enum(['riverValley','ridge']),shape:corridor}).strict(),
])
export type TerrainFeature = z.infer<typeof terrainFeatureSchema>

const precision = z.object({ sampleSpacingMm: positive, toleranceMm: positive, noiseCellMm: positive }).strict()
const recipeRef = z.object({ id, version: positive }).strict()
const member = z.object({ featureId: id, field: z.enum(['land', 'elevation', 'vegetation']), operation: z.enum(['add', 'subtract', 'max']), weightPpm: int.min(1).max(1_000_000) }).strict()
export const terrainCompositionSchema = z.object({ ...common, recipeRef, seed: z.string().min(1).max(128),
  boundsMm: bounds, algorithmId: z.literal('terrain-compose'), algorithmVersion: z.literal(1), precision,
  baseElevationMm: int, members: z.array(member).min(1).max(128), thresholdIds: z.array(id).max(2).refine(unique),
  requirementIds: z.array(id).max(256).refine(unique), outputRefs: z.array(generationReferenceV5Schema).max(256).refine(unique),
  state: z.enum(['active', 'paused', 'detached']), inputHash: hash, outputHash: hash,
}).strict().superRefine((value, ctx) => {
  const keys = value.members.map(item => `${item.featureId}:${item.field}`)
  if (!unique(keys)) ctx.addIssue({ code: 'custom', path: ['members'], message: '同一特征字段只能出现一次。' })
})
export type TerrainComposition = z.infer<typeof terrainCompositionSchema>

const surface = z.enum(['land', 'water'])
const requirementBase = { id, compositionId: id, strength: z.literal('hard') }
export const terrainRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ ...requirementBase, kind: z.literal('componentCount'), surface, excludeBoundaryTouching: z.boolean(), expected: int.min(0).max(16) }).strict(),
  z.object({ ...requirementBase, kind: z.literal('minimumComponentArea'), surface, excludeBoundaryTouching: z.boolean(), minAreaMm2: positive }).strict(),
  z.object({ ...requirementBase, kind: z.literal('channelWidth'), pointsMm: z.array(point).min(2).max(32), minWidthMm: positive }).strict(),
  z.object({ ...requirementBase, kind: z.literal('legacyConstraint'), constraintId: id }).strict(),
])
export type TerrainRequirement = z.infer<typeof terrainRequirementSchema>

export const terrainRequirementCheckSchema = z.object({ id, requirementId: id, algorithmId: z.literal('terrain-requirement'), algorithmVersion: z.literal(1),
  state: z.enum(['passed', 'failed', 'unchecked']), inputHash: hash,
  issues: z.array(z.object({ code: id, message: z.string().min(1).max(512), entityId: id.nullable() }).strict()).max(128),
}).strict()
export type TerrainRequirementCheck = z.infer<typeof terrainRequirementCheckSchema>

const thresholdSourceInput = z.object({ algorithmId: z.literal('terrain-compose'), algorithmVersion: z.literal(1), seed: z.string().min(1).max(128), precision,
  boundsMm: bounds, baseElevationMm: int, members: z.array(member).min(1).max(128), features: z.record(id, terrainFeatureSchema),
}).strict()
export const terrainThresholdSchema = z.object({ id, compositionId: id, field: z.enum(['land', 'elevation']), valueQ: int.min(-1_000_000).max(1_000_000), targetCoveragePpm: int.min(0).max(1_000_000),
  grid: z.object({ originMm: point, columns: int.min(2).max(512), rows: int.min(2).max(512), spacingMm: positive }).strict(), sourceInput: thresholdSourceInput, inputHash: hash,
}).strict().superRefine((value, ctx) => { if (value.grid.columns * value.grid.rows > 65536) ctx.addIssue({ code: 'custom', path: ['grid'], message: '阈值网格超过65536个采样。' }) })
export type TerrainThreshold = z.infer<typeof terrainThresholdSchema>

const dependencyRead = z.object({ target: generationReferenceV5Schema, role: z.enum(['preserve', 'baseline']), contentHash: hash, snapshot: z.unknown() }).strict()
export const terrainDependencySchema = z.object({ id, compositionId: id, featureIds: z.array(id).max(128).refine(unique), thresholdIds: z.array(id).max(2).refine(unique),
  reads: z.array(dependencyRead).max(256).refine(items => unique(items.map(item => JSON.stringify(item.target)))),
  writes: z.array(generationReferenceV5Schema).max(256).refine(unique), transitionIds: z.array(id).max(128).refine(unique), scopeMm: bounds, haloMm: nonnegative,
  algorithmId: z.literal('terrain-dependencies'), algorithmVersion: z.literal(1), inputHash: hash,
}).strict()
export type TerrainDependency = z.infer<typeof terrainDependencySchema>

export const generation5Schema = z.object({ version: z.literal(5), legacy: z.lazy(() => generationSchema),
  features: keyed(terrainFeatureSchema, 128), compositions: keyed(terrainCompositionSchema, 32), requirements: keyed(terrainRequirementSchema, 256),
  checks: keyed(terrainRequirementCheckSchema, 256), thresholds: keyed(terrainThresholdSchema, 64), dependencies: keyed(terrainDependencySchema, 256),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.requirements).length + Object.keys(value.legacy.constraints).length > 256) ctx.addIssue({ code: 'custom', path: ['requirements'], message: 'requirements 与 legacy.constraints 合计超过256项。' })
  if (Object.keys(value.checks).length + Object.keys(value.legacy.checks).length > 256) ctx.addIssue({ code: 'custom', path: ['checks'], message: 'checks 与 legacy.checks 合计超过256项。' })
  for (const row of Object.values(value.compositions)) {
    if (row.members.some(member => !value.features[member.featureId])) ctx.addIssue({ code: 'custom', path: ['compositions', row.id], message: '组合成员特征不存在。' })
    if (row.thresholdIds.some(id => !value.thresholds[id]) || row.requirementIds.some(id => !value.requirements[id])) ctx.addIssue({ code: 'custom', path: ['compositions', row.id], message: '组合引用阈值或要求不存在。' })
  }
  for (const row of Object.values(value.requirements)) if (!value.compositions[row.compositionId]) ctx.addIssue({ code: 'custom', path: ['requirements', row.id], message: '要求所属组合不存在。' })
  for (const row of Object.values(value.checks)) if (!value.requirements[row.requirementId]) ctx.addIssue({ code: 'custom', path: ['checks', row.id], message: '检查要求不存在。' })
})
export type GenerationSystem5 = z.infer<typeof generation5Schema>

const transitionPolygon = z.object({ id, pointsMm: z.array(point).min(3).max(512), fillColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), opacity: z.number().finite().min(0).max(1), materialRef: z.null() }).strict()
const transitionStroke = z.object({ id, pointsMm: z.array(point).min(2).max(512), widthMm: positive, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), opacity: z.number().finite().min(0).max(1) }).strict()
const distanceSource = z.object({ algorithmId: z.literal('terrain-distance'), algorithmVersion: z.literal(1), metric: z.literal('euclidean-mm'), boundaryHash: hash, clipMm: bounds, reachMm: positive, sampleSpacingMm: positive, inputHash: hash }).strict()
const transition = z.object({ ...common, enabled: z.boolean(), boundaryId: id, kind: z.enum(['shore', 'riverMouth', 'grassRock', 'forestEdge', 'cliff', 'pathShoulder']), side: z.enum(['left', 'right', 'both']), leftSurface: z.enum(['water', 'sand', 'soil', 'grass', 'rock', 'path', 'forest']), rightSurface: z.enum(['water', 'sand', 'soil', 'grass', 'rock', 'path', 'forest']), leftElevationMm: int, rightElevationMm: int, widthMm: positive, distanceSource, polygons: z.array(transitionPolygon).max(128), strokes: z.array(transitionStroke).max(256), inputHash: hash, outputHash: hash }).strict().superRefine((value, ctx) => { if (!value.polygons.length && !value.strokes.length) ctx.addIssue({ code: 'custom', message: '过渡必须有明确几何。' }) })
export const visual3TransitionSchema = transition
export function createVisual3Schema<T extends z.ZodType>(base: T) { return z.object({ version: z.literal(3), base, transitions: keyed(transition, 128) }).strict() }
export interface VisualSystem3<TBase = VisualSystem> { version: 3; base: VisualSystem2<TBase>; transitions: Record<string, TerrainTransition> }
export type TerrainTransition = z.infer<typeof transition>
export type TerrainTransitionPolygon = z.infer<typeof transitionPolygon>
export type TerrainTransitionStroke = z.infer<typeof transitionStroke>
export type TerrainIdentityToken = { kind: 'terrainFeature' | 'terrainComposition' | 'terrainRequirement' | 'terrainCheck' | 'terrainThreshold' | 'terrainDependency' | 'terrainTransition' | 'terrainTransitionPolygon' | 'terrainTransitionStroke'; token: string; topologyToken: string; topologyHash: string }
export const terrainIdentityTokenSchema = z.object({ kind: z.enum(['terrainFeature', 'terrainComposition', 'terrainRequirement', 'terrainCheck', 'terrainThreshold', 'terrainDependency', 'terrainTransition', 'terrainTransitionPolygon', 'terrainTransitionStroke']), token: id, topologyToken: id, topologyHash: hash }).strict()

export function createEmptyGeneration5(legacy?: z.infer<typeof generationSchema>): GenerationSystem5 {
  return { version: 5, legacy: legacy ?? createEmptyGeneration(), features: {}, compositions: {}, requirements: {}, checks: {}, thresholds: {}, dependencies: {} }
}

export type LegacyTerrainScene = Omit<SceneDocument, 'schemaVersion' | 'generation' | 'visual' | 'mapMode' | 'regional'> & { schemaVersion: 3; mapMode: 'scene' | 'regional'; generation: GenerationSystem1; visual: VisualSystem2<VisualSystem>; regional: RegionalModel1 | null }
export function getLegacyGeneration(scene: Pick<SceneDocument, 'generation'>): GenerationSystem1 | undefined {
  return scene.generation?.version === 5 ? scene.generation.legacy : scene.generation
}
export function getLegacyVisual(scene: Pick<SceneDocument, 'visual'>): VisualSystem2<VisualSystem> | undefined {
  return scene.visual?.version === 3 ? scene.visual.base : scene.visual?.version === 2 ? scene.visual : undefined
}
/** Read-only compatibility view for old algorithms, never a save/export value. */
export function legacyTerrainView(scene: Readonly<SceneDocument>): LegacyTerrainScene {
  if (scene.schemaVersion === 4) {
    if (scene.generation?.version !== 5 || scene.visual?.version !== 3) throw new Error('完整v4缺少严格generation5/visual3。')
    return { ...scene, schemaVersion: 3, generation: scene.generation.legacy, visual: scene.visual.base, mapMode: scene.mapMode!, regional: scene.regional ?? null }
  }
  return scene as LegacyTerrainScene
}
